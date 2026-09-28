import { useEffect, useState } from "react";
import { deliveryTrackingNote, percentText } from "@/lib/communicationsFlow";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import type { CommCampaignAnalytics } from "@/types/communications";
import { ErrorNote, LoadingRow } from "./shared";

/**
 * Per-campaign analytics inside the campaign panel. Rates are computed by the server from real message rows;
 * a rate that cannot be known (no denominator, or no delivery tracking on the channel) is shown as "n/a".
 * `refreshKey` changes whenever the panel reloads its own data so the figures follow the campaign.
 */
export function CampaignAnalyticsPanel({ campaignId, refreshKey }: { campaignId: string; refreshKey: unknown }) {
  const [a, setA] = useState<CommCampaignAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    communicationsApi
      .getCampaignAnalytics(campaignId)
      .then((r) => live && setA(r))
      .catch((e) => {
        if (live) {
          setA(null);
          setError(errorText(e));
        }
      });
    return () => {
      live = false;
    };
  }, [campaignId, refreshKey]);

  if (error) return <ErrorNote message={error} />;
  if (!a) return <LoadingRow />;

  const stat = (label: string, value: string | number) => (
    <div className="rounded-md border p-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat("Messages (excl. test)", a.totals.messages)}
        {stat("Accepted by provider", `${a.totals.accepted} (${percentText(a.rates.acceptedPercent)})`)}
        {stat("Failed", `${a.totals.failed} (${percentText(a.rates.failedPercent)})`)}
        {stat("Suppressed at creation/send", `${a.recipients.suppressed ?? 0} (${percentText(a.rates.suppressedPercent)})`)}
      </div>
      <p className="text-xs text-muted-foreground">
        {deliveryTrackingNote(a.deliveryTracking)}
        {a.deliveryTracking === "webhook" && <> Delivered: {percentText(a.rates.deliveredPercent)} of accepted.</>} Percentages are of messages that reached a final outcome.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 text-sm">
          <h4 className="font-medium">Provider attempts</h4>
          <p className="text-muted-foreground">
            {a.totals.providerAttempts} attempt(s) across {a.totals.messagesAttempted} message(s)
          </p>
          {a.byProvider.length === 0 ? <p className="text-muted-foreground">No provider has accepted a message yet.</p> : a.byProvider.map((p) => <p key={p.provider}>{p.provider}: <strong>{p.n}</strong></p>)}
        </div>
        <div className="space-y-1 text-sm">
          <h4 className="font-medium">Failure reasons</h4>
          {a.topFailureReasons.length === 0 ? (
            <p className="text-muted-foreground">No failures.</p>
          ) : (
            a.topFailureReasons.map((f) => (
              <p key={f.reason} className="flex justify-between gap-3">
                <span className="break-words">{f.reason}</span>
                <strong>{f.n}</strong>
              </p>
            ))
          )}
        </div>
      </div>
      {a.sentByHour.length > 0 && (
        <div className="space-y-1 text-sm">
          <h4 className="font-medium">Sent per hour</h4>
          {a.sentByHour.map((h) => (
            <p key={h.hour} className="flex justify-between text-muted-foreground">
              <span>{new Date(h.hour).toLocaleString()}</span>
              <strong className="text-foreground">{h.count}</strong>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
