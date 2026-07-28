
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Search, FileText, Calendar, Tag, ArrowRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";

interface VaultDocument {
  id: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
  last_updated: string;
}

export function VaultDocuments() {
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/vault/documents")
      .then(res => res.json())
      .then(data => {
        setDocs(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch docs:", err);
        setLoading(false);
      });
  }, []);

  const filteredDocs = docs.filter(doc => 
    doc.title.toLowerCase().includes(search.toLowerCase()) ||
    doc.content.toLowerCase().includes(search.toLowerCase()) ||
    doc.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search Vault..." 
            className="pl-9" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button className="font-bold">
          <Plus className="mr-2 h-4 w-4" /> New Document
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest">Accessing Vault...</p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <Card className="border-dashed py-20 flex flex-col items-center justify-center">
          <Database className="h-10 w-10 text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-medium text-sm">No strategic documents found in the vault.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredDocs.map((doc) => (
            <Card key={doc.id} className="hover:border-primary/50 transition-colors cursor-pointer group">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <Badge variant="outline" className="bg-primary/5 text-[10px] font-black uppercase tracking-widest px-2 py-0">
                    {doc.category}
                  </Badge>
                  <div className="flex gap-2">
                    {doc.tags?.map(tag => (
                      <span key={tag} className="text-[10px] text-muted-foreground">#{tag}</span>
                    ))}
                  </div>
                </div>
                <CardTitle className="text-xl font-bold mt-3 group-hover:text-primary transition-colors">
                  {doc.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-4">
                  {doc.content}
                </p>
                <div className="flex items-center justify-between pt-4 border-t border-dashed">
                  <div className="flex items-center text-[10px] text-muted-foreground">
                    <Calendar className="mr-1 h-3 w-3" />
                    Last Updated: {new Date(doc.last_updated).toLocaleDateString()}
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 text-[10px] font-bold uppercase tracking-widest">
                    Edit <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { Database } from "lucide-react";
