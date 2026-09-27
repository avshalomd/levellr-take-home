import { Chat } from "@/components/chat/Chat";

// The chat. It gets a fresh id on every visit (chats are not saved: history is out of scope), which useChat sends with
// each request. ?q= asks a question straight away (a deep link, and how the eval can open an answer in the browser).
export default async function Home({ searchParams }: PageProps<"/">) {
  const q = (await searchParams).q;
  const id = crypto.randomUUID();
  return <Chat key={id} id={id} initialQuestion={typeof q === "string" ? q : undefined} />;
}
