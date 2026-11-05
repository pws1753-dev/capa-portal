import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { EmailListEditor } from "./EmailListEditor";

type Routing = { commonCc: string[]; excludeEmails: string[]; defaultCommonCc: string[] };

/** Portal-wide recipient rules: who is copied on every complaint/CAPA email, and who is never emailed. */
export function EmailRecipientRules() {
  const queryClient = useQueryClient();
  const [commonCc, setCommonCc] = useState<string[]>([]);
  const [excludeEmails, setExcludeEmails] = useState<string[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const query = useQuery({ queryKey: ["email-routing"], queryFn: () => api<Routing>("/api/email/routing") });

  useEffect(() => {
    if (query.data) {
      setCommonCc(query.data.commonCc);
      setExcludeEmails(query.data.excludeEmails);
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => api<Routing>("/api/email/routing", { method: "PUT", body: JSON.stringify({ commonCc, excludeEmails }) }),
    onSuccess: () => {
      setMessage({ ok: true, text: "Recipient rules saved. They apply to every email sent from now on." });
      void queryClient.invalidateQueries({ queryKey: ["email-routing"] });
    },
    onError: (error: Error) => setMessage({ ok: false, text: errorText(error, "The recipient rules could not be saved.") })
  });

  const data = query.data;
  const dirty =
    data !== undefined && (JSON.stringify(commonCc) !== JSON.stringify(data.commonCc) || JSON.stringify(excludeEmails) !== JSON.stringify(data.excludeEmails));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 h-4 w-4 text-brand-red" />
          <div>
            <h3 className="text-sm font-bold text-brand-charcoal">Recipient rules for all emails</h3>
            <p className="text-xs text-slate-500">Edit who is copied on every complaint and CAPA email, and who is never emailed. Template-specific lists are in each template's editor.</p>
          </div>
        </div>
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {save.isPending ? "Saving..." : "Save rules"}
        </Button>
      </div>

      {query.isError ? <p className="mt-3 text-xs text-brand-red">{errorText(query.error, "The recipient rules could not be loaded.")}</p> : null}

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <EmailListEditor
          label="Common CC (every complaint and CAPA email)"
          hint="These mailboxes are copied on every complaint and CAPA email. Department Manager and HOD are added automatically."
          value={commonCc}
          onChange={setCommonCc}
          disabled={!data}
        />
        <EmailListEditor
          label="Never email these addresses (all emails)"
          hint="Use this to remove someone, for example a person who should no longer receive portal emails. It overrides every other rule, including Manager/HOD lookups from the Employee Directory."
          value={excludeEmails}
          onChange={setExcludeEmails}
          disabled={!data}
          tone="danger"
        />
      </div>

      {message ? <p className={`mt-3 text-xs font-semibold ${message.ok ? "text-green-700" : "text-brand-red"}`}>{message.text}</p> : null}
    </div>
  );
}
