import { Link } from 'react-router-dom';
import { Bus } from 'lucide-react';
import { SignInForm } from '@/components/SignInForm.jsx';

export default function ConductorLoginPage({ onLogin }) {
  return (
    <SignInForm
      home="/conductor"
      icon={Bus}
      title="Conductor sign-in"
      subtitle="Sign in to see your trip and log checkpoints."
      onLogin={onLogin}
      footer={
        <>
          Checking on a bus as a passenger?{' '}
          <Link to="/" className="font-semibold text-primary underline-offset-4 hover:underline">
            Open the arrivals board
          </Link>{' '}
          — no account needed.
        </>
      }
    />
  );
}
