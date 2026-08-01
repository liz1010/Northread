import { LoginForm } from "./LoginForm.tsx";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <LoginForm next={next ?? "/"} />
    </div>
  );
}
