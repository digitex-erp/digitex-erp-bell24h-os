import type { ReactNode } from "react";

interface CapabilityGateProps {
  enabled: boolean;
  name: string;
  children: ReactNode;
}

/** Shows a plain "not available yet" state instead of the page when off. */
export function CapabilityGate({ enabled, name, children }: CapabilityGateProps) {
  if (enabled) return <>{children}</>;
  return (
    <div className="p-6" role="status">
      <h1 className="text-2xl font-bold mb-2">{name}</h1>
      <p className="text-muted-foreground">
        {name} is not available yet. This capability has not been built, so jobs
        cannot be started and no results will be produced.
      </p>
    </div>
  );
}
