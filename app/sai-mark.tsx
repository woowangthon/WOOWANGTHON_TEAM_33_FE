/** Two conversation bubbles: the citizen and the staff member meeting in between. */
export default function SaiMark({size=32}:{size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <path d="M10 16a7 7 0 0 1 7-7h25a7 7 0 0 1 7 7v17a7 7 0 0 1-7 7H27L14 50V39a7 7 0 0 1-4-6Z" fill="currentColor"/>
    <path d="M32 29a6 6 0 0 1 6-6h14a6 6 0 0 1 6 6v15a6 6 0 0 1-4 6v9L43 50h-5a6 6 0 0 1-6-6Z" fill="currentColor" opacity=".45"/>
    <path d="M32 29a6 6 0 0 1 6-6h11v10a7 7 0 0 1-7 7H32Z" fill="white" opacity=".8"/>
  </svg>;
}
