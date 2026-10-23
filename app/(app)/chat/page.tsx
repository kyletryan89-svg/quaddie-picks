import { ChatBoard } from '@/components/ChatBoard';
import { requireProfile } from '@/lib/auth';
import { getProfiles } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const { userId } = await requireProfile();
  const profiles = await getProfiles();
  const names: Record<string, string> = {};
  for (const p of profiles) names[p.id] = p.display_name;

  return <ChatBoard currentUserId={userId} names={names} />;
}
