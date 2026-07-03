import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublishingCenterService, PublishingQueueItem } from "@/modules/publishing-center/PublishingCenterService";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function PublishingCenterPage() {
  const [queue, setQueue] = useState<PublishingQueueItem[]>([]);

  useEffect(() => {
    PublishingCenterService.getInstance().getQueue().then(setQueue);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Publishing Center</h1>
      <Card>
        <CardHeader><CardTitle>Publishing Queue</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package ID</TableHead>
                <TableHead>Channel ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scheduled At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map(item => (
                <TableRow key={item.id}>
                  <TableCell>{item.media_package_id}</TableCell>
                  <TableCell>{item.channel_id}</TableCell>
                  <TableCell>{item.status}</TableCell>
                  <TableCell>{item.scheduled_at || 'Immediate'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
