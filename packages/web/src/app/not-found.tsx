import { ButtonLink, Card, Logo } from "../components/ui";

/**
 * Every `notFound()` of the app ends here, including a fund the person isn't part of: the page never says
 * whether the fund exists, only that this link leads nowhere for them.
 */
export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-[560px] gap-4 p-4 pt-10">
      <Logo />
      <Card className="grid gap-4">
        <h1 className="text-2xl font-bold [font-stretch:87%]">No encontramos esa página</h1>
        <p className="text-muted">Puede que el link esté mal o que no seas parte de este fondo.</p>
        <ButtonLink href="/">Ir al inicio</ButtonLink>
      </Card>
    </main>
  );
}
