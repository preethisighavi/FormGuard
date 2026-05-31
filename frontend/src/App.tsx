// State-based screen switch (no router lib). The PT dashboard is reachable at
// the hash route #pt so it works on static hosting (Insforge Sites) with no SPA
// rewrites — and can be opened in a second tab for the two-screen demo.

import { useEffect, useState } from "react";
import type { CreateSessionRes, Program } from "./lib/backend";
import { LiveSession } from "./screens/LiveSession";
import { PtDashboard } from "./screens/PtDashboard";
import { Setup } from "./screens/Setup";
import { Summary } from "./screens/Summary";

type Screen = "setup" | "live" | "summary";

function useIsPt() {
  const [isPt, setIsPt] = useState(
    () => window.location.hash.replace("#", "") === "pt",
  );
  useEffect(() => {
    const onHash = () =>
      setIsPt(window.location.hash.replace("#", "") === "pt");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return isPt;
}

export default function App() {
  const isPt = useIsPt();
  const [screen, setScreen] = useState<Screen>("setup");
  const [session, setSession] = useState<CreateSessionRes | null>(null);
  const [patientName, setPatientName] = useState("");
  const [program, setProgram] = useState<Program>("knee_rehab");

  if (isPt) return <PtDashboard />;

  if (screen === "setup") {
    return (
      <Setup
        onStart={(s, name, prog) => {
          setSession(s);
          setPatientName(name);
          setProgram(prog);
          setScreen("live");
        }}
      />
    );
  }

  if (screen === "live" && session) {
    return (
      <LiveSession
        session={session}
        patientName={patientName}
        program={program}
        onComplete={() => setScreen("summary")}
      />
    );
  }

  if (screen === "summary" && session) {
    return (
      <Summary
        sessionId={session.session_id}
        onPt={() => (window.location.hash = "pt")}
      />
    );
  }

  return null;
}
