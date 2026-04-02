import { MessageSquare } from "lucide-react";
import { CommentForm } from "./comment-form";
import { Separator } from "@/components/ui/separator";
import type { Comment, User } from "@/types/database";

interface CommentWithUser extends Comment {
  author?: Pick<User, "id" | "full_name" | "role"> | null;
}

interface CommentListProps {
  caseId: string;
  comments: CommentWithUser[];
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString("es-PA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function getUserInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

export function CommentList({ caseId, comments }: CommentListProps) {
  return (
    <div className="space-y-6">
      {/* Comments Thread */}
      {comments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center">
          <MessageSquare size={28} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-400">Sin comentarios. Sea el primero en comentar.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {comments.map((comment, index) => {
            const initials = comment.author
              ? getUserInitials(comment.author.full_name)
              : "?";
            const authorName = comment.author?.full_name ?? "Usuario";

            return (
              <li key={comment.id}>
                <div className="flex gap-3">
                  {/* Avatar */}
                  <div
                    aria-hidden="true"
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-integra-navy text-xs font-semibold text-white"
                  >
                    {initials}
                  </div>

                  {/* Bubble */}
                  <div className="flex-1 min-w-0">
                    <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-integra-navy">{authorName}</span>
                        <span className="text-xs text-gray-400">{formatDateTime(comment.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
                        {comment.text}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Subtle divider between comments, not after last */}
                {index < comments.length - 1 && (
                  <div className="ml-12 mt-4 border-t border-gray-100" />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Add Comment Form */}
      <Separator className="my-2" />
      <CommentForm caseId={caseId} />
    </div>
  );
}
