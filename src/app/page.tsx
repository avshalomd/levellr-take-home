import { Chat } from "@/components/chat/Chat";

// A new chat. It gets a fresh id on every visit; the chat is saved under that id when its first question reaches the
// server (api/chat), and the address moves to /c/<id> as the answer starts. ?q= asks a question straight away (a deep
// link, and how the eval can open an answer in the browser).
export default async function Home({ searchParams }: PageProps<"/">) {
  const q = (await searchParams).q;
  const id = crypto.randomUUID();
  return <Chat key={id} id={id} initialQuestion={typeof q === "string" ? q : undefined} />;
}
