import { SignInForm } from '../../components/SignInForm.jsx';

export default function ConductorLoginPage({ onLogin }) {
  return (
    <SignInForm
      home="/conductor"
      title="Conductor sign-in"
      subtitle="Sign in to see your trip and log checkpoints."
      onLogin={onLogin}
      footer={
        <>
          Checking on a bus as a passenger? <a href="/">Open the arrivals board</a> — no account
          needed.
        </>
      }
    />
  );
}
