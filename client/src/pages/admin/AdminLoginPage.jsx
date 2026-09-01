import { SignInForm } from '../../components/SignInForm.jsx';

export default function AdminLoginPage({ onLogin }) {
  return (
    <SignInForm
      home="/admin"
      title="Operations sign-in"
      subtitle="Manage routes, checkpoints, buses, conductors and trips."
      onLogin={onLogin}
      footer={
        <>
          Conductors sign in at <a href="/conductor">the conductor app</a>.
        </>
      }
    />
  );
}
