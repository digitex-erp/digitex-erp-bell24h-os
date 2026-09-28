
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Library, 
  Search, 
  Filter, 
  FileText, 
  Image as ImageIcon, 
  Mic, 
  Video as VideoIcon,
  Brain,
  Star,
  Loader2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { authedFetchJson } from "@/lib/authedFetch";
import { vaultLoadError } from "@/lib/diagnosticsErrors";

interface RdItem {
  id: string;
  title: string;
  category: string;
  status: string;
  ai_summary: string;
  tags: string[];
}

const RD_CATEGORIES = [
  "Ice Cup Research", "Packaging Research", "Cold Chain Research", 
  "Manufacturing Research", "Supplier Research", "White Label Research", 
  "Premium Diamond Ice Research", "Hotel Research", "Luxury Ice Research",
  "Brand Research", "Financial Models", "Logistics Research", 
  "Customer Research", "Government & FSSAI Research", "Future Innovation"
];

export function RdLibrary() {
  const [items, setItems] = useState<RdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    authedFetchJson<RdItem[]>("/api/vault/rd")
      .then(data => {
        setItems(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch RD items:", err);
        setError(vaultLoadError(err, "the research library"));
        setItems([]);
        setLoading(false);
      });
  }, []);

  const filteredItems = items.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(search.toLowerCase()) ||
                         item.ai_summary?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory ? item.category === selectedCategory : true;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Sidebar categories */}
        <div className="space-y-4">
          <div className="font-bold text-sm uppercase tracking-widest text-muted-foreground px-2">Categories</div>
          <div className="h-[500px] overflow-y-auto pr-2">
            <div className="space-y-1">
              <Button 
                variant={selectedCategory === null ? "secondary" : "ghost"} 
                className="w-full justify-start text-[11px] font-bold h-9 px-3"
                onClick={() => setSelectedCategory(null)}
              >
                All Categories
              </Button>
              {RD_CATEGORIES.map(cat => (
                <Button 
                  key={cat} 
                  variant={selectedCategory === cat ? "secondary" : "ghost"} 
                  className="w-full justify-start text-[11px] font-medium h-9 px-3 hover:bg-primary/5 hover:text-primary"
                  onClick={() => setSelectedCategory(cat)}
                >
                  <Star className={`mr-2 h-3 w-3 ${selectedCategory === cat ? 'fill-primary text-primary' : 'opacity-50'}`} />
                  {cat}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="md:col-span-3 space-y-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search Research Library..." 
                className="pl-9" 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline">
              <Filter className="mr-2 h-4 w-4" /> Filter
            </Button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest">Opening Library...</p>
            </div>
          ) : error ? (
            <Card className="border-dashed border-destructive/40 py-20 flex flex-col items-center justify-center">
              <Library className="h-10 w-10 text-destructive mb-4" />
              <p className="text-destructive font-medium text-sm">{error}</p>
            </Card>
          ) : filteredItems.length === 0 ? (
            <Card className="border-dashed py-20 flex flex-col items-center justify-center">
              <Library className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="text-muted-foreground font-medium text-sm">No research documents found in this category.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredItems.map((item) => (
                <Card key={item.id} className="overflow-hidden border-l-4 border-l-primary">
                  <CardHeader className="py-4">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[9px] font-bold uppercase">{item.category}</Badge>
                          <Badge variant="outline" className={`text-[9px] font-bold uppercase ${item.status === 'Final' ? 'text-green-500' : 'text-amber-500'}`}>
                            {item.status}
                          </Badge>
                        </div>
                        <CardTitle className="text-lg font-bold">{item.title}</CardTitle>
                      </div>
                      <div className="flex gap-2">
                        <Button size="icon" variant="ghost" className="h-8 w-8"><ImageIcon className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8"><Mic className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8"><Brain className="h-4 w-4 text-primary" /></Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <p className="text-sm text-muted-foreground mb-4">{item.ai_summary}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        {item.tags?.map(tag => (
                          <span key={tag} className="text-[10px] bg-muted px-2 py-0.5 rounded">#{tag}</span>
                        ))}
                      </div>
                      <Button variant="ghost" size="sm" className="text-[10px] font-bold uppercase">View Document</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
