import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// No StrictMode: this app holds imperative real-time resources (getUserMedia,
// intervals, the Gemini WebSocket). StrictMode's dev double-mount would start two
// camera streams / two coach loops, which diverges from production behavior.
createRoot(document.getElementById("root")!).render(<App />);
