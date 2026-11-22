import { Breadcrumb, type Crumb } from "../Breadcrumb.js";
import type { OpenTarget } from "../ideation/types.js";
import { SpecDocumentHost } from "./SpecDocumentHost.js";
import { SpecDocuments } from "./SpecDocuments.js";

/**
 * Home > Specify. Lists the project's spec documents (the Studio runs in one
 * project) and opens one in the appropriate editor inline.
 *
 * The open document is **controlled** by `VetraStudio` (lifted so auto-nav
 * can drive it).
 */
export function SpecifySection({
  productName,
  open,
  onOpen,
  onClear,
  onExitToHome,
}: {
  productName: string;
  open: OpenTarget | null;
  onOpen: (target: OpenTarget) => void;
  onClear: () => void;
  onExitToHome: () => void;
}) {
  const crumbs: Crumb[] = [
    { label: productName, onClick: onExitToHome },
    { label: "Specify", onClick: open ? onClear : undefined },
    ...(open ? [{ label: open.name }] : []),
  ];

  return (
    <div data-tour="specify" className="mx-auto max-w-5xl px-8 py-8">
      <Breadcrumb items={crumbs} />
      {open ? (
        <SpecDocumentHost
          id={open.id}
          documentType={open.documentType}
          onClose={onClear}
        />
      ) : (
        <SpecDocuments onOpen={onOpen} />
      )}
    </div>
  );
}
