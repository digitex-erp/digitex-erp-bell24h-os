export class KnowledgeBaseService {
  static async search(query: string) {
    console.log("Vector search for:", query);
    return [];
  }
  static async ingestDocument(doc: File) {
    console.log("Ingesting document into vector store:", doc.name);
  }
}
