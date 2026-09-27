import { NotHere } from "@/components/shell/NotHere";

// Chats belong to the browser that asked them (the owner cookie), so a link from someone else lands here too.
export default function ChatNotFound() {
  return (
    <NotHere
      title="This chat is not here"
      detail="It may have been deleted, or it was asked in another browser: chats are kept only for the browser that asked them."
    />
  );
}
