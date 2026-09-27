import { cache } from "react";
import { notFound } from "next/navigation";
import { Chat } from "@/components/chat/Chat";
import { getChat } from "@/lib/data/chats";
import { ownerId } from "@/lib/owner";

// A saved chat, reopened: its messages load on the server and the conversation continues under the same id, so the
// next answer is saved into it. A chat reopened while its answer is still being written (a reload mid-answer) says so
// and shows the answer when the server has saved it. Only the browser that owns it can open it (getChat is scoped to the owner cookie).

const load = cache(async (id: string) => {
  const owner = await ownerId();
  return owner ? getChat(id, owner) : null;
});

// A chat that is not there says so in the tab too, as its page does (QA 2026-09-26: the tab read "Chat").
export async function generateMetadata({ params }: PageProps<"/c/[id]">) {
  const chat = await load((await params).id);
  return { title: chat?.title ?? "Chat not found" };
}

export default async function SavedChat({ params }: PageProps<"/c/[id]">) {
  const { id } = await params;
  const chat = await load(id);
  if (!chat) notFound();
  return <Chat key={chat.id} id={chat.id} initialMessages={chat.messages} answering={chat.answering} />;
}
