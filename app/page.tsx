import { currentUser } from "@/lib/auth/server";
import Dashboard from "@/components/dashboard";
import SignIn from "@/components/sign-in";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await currentUser();
  if (!user || !user.emailVerified) return <SignIn />;
  return <Dashboard key={user.id} user={{ id: user.id, email: user.email, name: user.name || user.email }} />;
}
