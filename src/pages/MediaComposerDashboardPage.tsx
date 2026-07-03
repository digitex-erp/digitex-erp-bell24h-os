import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaComposerService, MediaPackage } from "@/modules/media-composer/MediaComposerService";
import { Button } from "@/components/ui/button";

export function MediaComposerDashboardPage() {
  const [packages, setPackages] = useState<MediaPackage[]>([]);

  useEffect(() => {
    MediaComposerService.getInstance().getPackages().then(setPackages);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Media Composer Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>Total Packages</CardTitle></CardHeader>
          <CardContent>
            {packages.length}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
