import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { SignInForm } from '@/components/SignInForm.jsx';

export default function AdminLoginPage({ onLogin }) {
  return (
    <SignInForm
      home="/admin"
      icon={ShieldCheck}
      title="Operations sign-in"
      subtitle="Manage routes, checkpoints, buses, conductors and trips."
      onLogin={onLogin}
      footer={
        <>
          Conductors sign in at{' '}
          <Link
            to="/conductor"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            the conductor app
          </Link>
          .
        </>
      }
    />
  );
}
