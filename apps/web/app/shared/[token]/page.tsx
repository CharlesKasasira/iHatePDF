"use client";

import { Download, FileText, MessageSquare, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SiteHeader } from "../../components/site-header";
import {
  createSharedFileComment,
  getSharedFile,
  type SharedFileComment,
  type SharedFileMetadataResponse
} from "../../lib/pdf-api";
import { formatEatDateTime } from "../../lib/time";

function bytesLabel(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "PDF file";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SharedPdfPage(): React.JSX.Element {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [file, setFile] = useState<SharedFileMetadataResponse | null>(null);
  const [comments, setComments] = useState<SharedFileComment[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [status, setStatus] = useState("Loading shared PDF...");

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const sharedFile = await getSharedFile(token);
        if (!cancelled) {
          setFile(sharedFile);
          setComments(sharedFile.comments);
          setStatus("");
        }
      } catch (error) {
        if (!cancelled) {
          setStatus((error as Error).message);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const postComment = async (): Promise<void> => {
    if (!token || !commentBody.trim()) {
      setStatus("Write a comment before posting.");
      return;
    }

    try {
      setPosting(true);
      const comment = await createSharedFileComment(token, {
        authorName: authorName.trim() || undefined,
        authorEmail: authorEmail.trim() || undefined,
        pageNumber,
        body: commentBody.trim()
      });
      setComments((current) => [comment, ...current]);
      setCommentBody("");
      setStatus("Comment posted.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Shared PDF review</h1>
          <p>Download the file, leave page comments, and keep the review thread with this expiring link.</p>
        </section>

        <section className="merge-workbench shared-file-card">
          {file ? (
            <>
              <span className="share-workbench__icon">
                <FileText aria-hidden="true" size={24} />
              </span>
              <div>
                <h2>{file.fileName}</h2>
                <p className="small">
                  {bytesLabel(file.sizeBytes)} · Expires {formatEatDateTime(file.expiresAt)}
                </p>
              </div>
              <a className="download shared-file-card__download" href={file.downloadUrl}>
                <Download aria-hidden="true" size={18} />
                <span>Download PDF</span>
              </a>
            </>
          ) : (
            <div className="tool-empty-state">
              <strong>{status || "Shared file unavailable."}</strong>
              <span>{token ? "Ask the sender for a fresh link if this one has expired." : "Checking the link..."}</span>
            </div>
          )}
        </section>

        {file ? (
          <section className="merge-workbench shared-review-panel">
            <div className="share-workbench__header">
              <span className="share-workbench__icon">
                <MessageSquare aria-hidden="true" size={22} />
              </span>
              <div>
                <h2>Review comments</h2>
                <p className="small">{comments.length} comment{comments.length === 1 ? "" : "s"} on this shared PDF.</p>
              </div>
            </div>

            <div className="shared-comment-form">
              <div className="grid two">
                <div>
                  <label htmlFor="review-name">Name</label>
                  <input
                    id="review-name"
                    value={authorName}
                    onChange={(event) => setAuthorName(event.target.value)}
                    placeholder="Reviewer name"
                    disabled={posting}
                  />
                </div>
                <div>
                  <label htmlFor="review-email">Email</label>
                  <input
                    id="review-email"
                    type="email"
                    value={authorEmail}
                    onChange={(event) => setAuthorEmail(event.target.value)}
                    placeholder="name@example.com"
                    disabled={posting}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="review-page">Page</label>
                <input
                  id="review-page"
                  type="number"
                  min={1}
                  value={pageNumber}
                  onChange={(event) => setPageNumber(Math.max(1, Number(event.target.value) || 1))}
                  disabled={posting}
                />
              </div>
              <label htmlFor="review-comment">Comment</label>
              <textarea
                id="review-comment"
                value={commentBody}
                onChange={(event) => setCommentBody(event.target.value)}
                placeholder="Add a page-specific note for the sender"
                disabled={posting}
              />
              <button className="start-process-btn" type="button" onClick={() => void postComment()} disabled={posting}>
                <Send aria-hidden="true" size={18} />
                <span>{posting ? "Posting..." : "Post comment"}</span>
              </button>
              {status ? <p className="small">{status}</p> : null}
            </div>

            <div className="shared-comment-list">
              {comments.length === 0 ? (
                <div className="tool-empty-state">
                  <strong>No comments yet.</strong>
                  <span>Start the review by adding a note tied to a page number.</span>
                </div>
              ) : null}
              {comments.map((comment) => (
                <article className="shared-comment" key={comment.id}>
                  <div>
                    <strong>Page {comment.pageNumber}</strong>
                    <span>{comment.authorName || comment.authorEmail || "Reviewer"} · {formatEatDateTime(comment.createdAt)}</span>
                  </div>
                  <p>{comment.body}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
