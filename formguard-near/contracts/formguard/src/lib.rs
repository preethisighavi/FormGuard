use near_sdk::collections::UnorderedMap;
use near_sdk::{env, near, PanicOnDefault};

// ── Data structures ──────────────────────────────────────────────────────────

#[near(serializers = [json])]
#[derive(Clone)]
pub struct NearRepAttestation {
    pub tx_hash: String,
    pub session_id: String,
    pub rep_number: u32,
    pub session_hash: String,
    pub quality_score: u8,
    pub form_state: String, // GREEN | YELLOW | RED
    pub timestamp: u64,
}

#[near(serializers = [json])]
pub struct SessionComplianceReport {
    pub session_id: String,
    pub total_reps: u32,
    pub green_count: u32,
    pub yellow_count: u32,
    pub red_count: u32,
    pub green_pct: u8,
    pub compliant: bool, // true if green_pct >= 80
    pub attestations: Vec<NearRepAttestation>,
}

#[near(serializers = [json])]
pub struct PatientStats {
    pub patient_id: String,
    pub total_sessions: u32,
    pub total_reps: u32,
    pub overall_compliance: u8,
    pub recent_trend: String, // "improving" | "stable" | "declining"
}

// ── Contract state ───────────────────────────────────────────────────────────

// Storage key prefix for nested maps
const REPS_PREFIX: &[u8] = b"r";
const PATIENT_SESSIONS_PREFIX: &[u8] = b"p";

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct FormGuardContract {
    // session_id → serialized Vec<NearRepAttestation> (JSON)
    // We use UnorderedMap<String, String> and serialize the inner vec ourselves
    // to keep the contract simple without nested collections.
    sessions: UnorderedMap<String, String>,
    // patient_id → serialized Vec<String> (session_ids)
    patient_sessions: UnorderedMap<String, String>,
}

#[near]
impl FormGuardContract {
    #[init]
    pub fn new() -> Self {
        Self {
            sessions: UnorderedMap::new(REPS_PREFIX),
            patient_sessions: UnorderedMap::new(PATIENT_SESSIONS_PREFIX),
        }
    }

    // ── attest_rep ───────────────────────────────────────────────────────────

    pub fn attest_rep(
        &mut self,
        session_id: String,
        rep_number: u32,
        session_hash: String,
        quality_score: u8,
        form_state: String,
    ) -> NearRepAttestation {
        let tx_hash = env::sha256(
            format!("{}:{}:{}", session_id, rep_number, session_hash).as_bytes(),
        );
        let tx_hash_hex = hex_encode(&tx_hash);

        let attestation = NearRepAttestation {
            tx_hash: tx_hash_hex,
            session_id: session_id.clone(),
            rep_number,
            session_hash,
            quality_score,
            form_state,
            timestamp: env::block_timestamp(),
        };

        // Load existing reps for session (idempotent upsert by rep_number)
        let mut reps = self.load_reps(&session_id);
        reps.retain(|r| r.rep_number != rep_number);
        reps.push(attestation.clone());
        self.save_reps(&session_id, &reps);

        attestation
    }

    // ── verify_session ───────────────────────────────────────────────────────

    pub fn verify_session(&self, session_id: String) -> SessionComplianceReport {
        let reps = self.load_reps(&session_id);
        let total = reps.len() as u32;
        let green_count = reps.iter().filter(|r| r.form_state == "GREEN").count() as u32;
        let yellow_count = reps.iter().filter(|r| r.form_state == "YELLOW").count() as u32;
        let red_count = reps.iter().filter(|r| r.form_state == "RED").count() as u32;
        let green_pct = if total > 0 {
            ((green_count as f64 / total as f64) * 100.0) as u8
        } else {
            0
        };

        SessionComplianceReport {
            session_id,
            total_reps: total,
            green_count,
            yellow_count,
            red_count,
            green_pct,
            compliant: green_pct >= 80,
            attestations: reps,
        }
    }

    // ── get_patient_stats ────────────────────────────────────────────────────

    pub fn get_patient_stats(&self, patient_id: String) -> PatientStats {
        let session_ids = self.load_patient_sessions(&patient_id);
        let total_sessions = session_ids.len() as u32;

        let mut session_scores: Vec<u8> = Vec::new();
        let mut total_reps: u32 = 0;

        for sid in &session_ids {
            let reps = self.load_reps(sid);
            let n = reps.len() as u32;
            total_reps += n;
            if n > 0 {
                let green = reps.iter().filter(|r| r.form_state == "GREEN").count() as u32;
                session_scores.push(((green as f64 / n as f64) * 100.0) as u8);
            }
        }

        let overall_compliance = if session_scores.is_empty() {
            0
        } else {
            (session_scores.iter().map(|&s| s as u32).sum::<u32>() / session_scores.len() as u32)
                as u8
        };

        let recent_trend = if session_scores.len() >= 2 {
            let last = *session_scores.last().unwrap() as i16;
            let first = session_scores[0] as i16;
            if last > first {
                "improving"
            } else if last < first {
                "declining"
            } else {
                "stable"
            }
        } else {
            "stable"
        }
        .to_string();

        PatientStats {
            patient_id,
            total_sessions,
            total_reps,
            overall_compliance,
            recent_trend,
        }
    }

    // ── register_patient_session (called by signing relay after attest) ──────

    pub fn register_patient_session(&mut self, patient_id: String, session_id: String) {
        let mut sessions = self.load_patient_sessions(&patient_id);
        if !sessions.contains(&session_id) {
            sessions.push(session_id);
            self.save_patient_sessions(&patient_id, &sessions);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    fn load_reps(&self, session_id: &str) -> Vec<NearRepAttestation> {
        self.sessions
            .get(&session_id.to_string())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_reps(&mut self, session_id: &str, reps: &Vec<NearRepAttestation>) {
        let s = serde_json::to_string(reps).expect("serialize reps");
        self.sessions.insert(&session_id.to_string(), &s);
    }

    fn load_patient_sessions(&self, patient_id: &str) -> Vec<String> {
        self.patient_sessions
            .get(&patient_id.to_string())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_patient_sessions(&mut self, patient_id: &str, sessions: &Vec<String>) {
        let s = serde_json::to_string(sessions).expect("serialize sessions");
        self.patient_sessions.insert(&patient_id.to_string(), &s);
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn setup() -> FormGuardContract {
        let context = VMContextBuilder::new().build();
        testing_env!(context);
        FormGuardContract::new()
    }

    #[test]
    fn test_attest_and_verify() {
        let mut contract = setup();

        contract.attest_rep(
            "sess_001".into(),
            1,
            "abc123hash".into(),
            90,
            "GREEN".into(),
        );
        contract.attest_rep(
            "sess_001".into(),
            2,
            "def456hash".into(),
            70,
            "YELLOW".into(),
        );
        contract.attest_rep(
            "sess_001".into(),
            3,
            "ghi789hash".into(),
            40,
            "RED".into(),
        );

        let report = contract.verify_session("sess_001".into());
        assert_eq!(report.total_reps, 3);
        assert_eq!(report.green_count, 1);
        assert_eq!(report.yellow_count, 1);
        assert_eq!(report.red_count, 1);
        assert_eq!(report.green_pct, 33);
        assert!(!report.compliant);
    }

    #[test]
    fn test_idempotent_upsert() {
        let mut contract = setup();

        contract.attest_rep("sess_002".into(), 1, "hashA".into(), 90, "GREEN".into());
        contract.attest_rep("sess_002".into(), 1, "hashA".into(), 90, "GREEN".into());

        let report = contract.verify_session("sess_002".into());
        assert_eq!(report.total_reps, 1, "Duplicate rep must not double-count");
    }

    #[test]
    fn test_compliant_session() {
        let mut contract = setup();
        for i in 1..=10u32 {
            let state = if i <= 9 { "GREEN" } else { "YELLOW" };
            contract.attest_rep("sess_003".into(), i, format!("h{}", i), 85, state.into());
        }
        let report = contract.verify_session("sess_003".into());
        assert!(report.compliant, "90% green should be compliant");
    }

    #[test]
    fn test_patient_stats() {
        let mut contract = setup();

        contract.attest_rep("s1".into(), 1, "h1".into(), 90, "GREEN".into());
        contract.attest_rep("s1".into(), 2, "h2".into(), 90, "GREEN".into());
        contract.register_patient_session("pat_001".into(), "s1".into());

        contract.attest_rep("s2".into(), 1, "h3".into(), 40, "RED".into());
        contract.register_patient_session("pat_001".into(), "s2".into());

        let stats = contract.get_patient_stats("pat_001".into());
        assert_eq!(stats.total_sessions, 2);
        assert_eq!(stats.total_reps, 3);
        assert_eq!(stats.recent_trend, "declining");
    }
}
