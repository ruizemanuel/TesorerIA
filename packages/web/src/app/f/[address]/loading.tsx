/** Quiet gray blocks in the shape of the list and the movements (spec, 9.2). */
export default function Loading() {
  const block = "rounded-[14px] bg-line";
  return (
    <div
      className="mx-auto grid max-w-[560px] gap-3 p-4 lg:max-w-[1120px] lg:grid-cols-[380px_1fr] lg:items-start lg:gap-4 lg:p-7"
      role="status"
      aria-busy="true"
      aria-label="Cargando"
    >
      <div className="grid gap-3 lg:gap-4">
        <div className={`${block} h-44`} />
        <div className={`${block} h-64`} />
      </div>
      <div className={`${block} h-32 lg:h-[26rem]`} />
    </div>
  );
}
