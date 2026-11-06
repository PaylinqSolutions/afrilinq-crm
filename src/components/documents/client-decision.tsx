"use client";

import { useState } from "react";
import { ActionForm, Checkbox, Input, Submit, Textarea } from "../forms";
import { publicAcceptAction, publicDeclineAction } from "@/app/actions/documents";

/** Client-side accept/sign or decline, shown under the document on the public link. */
export function ClientDecision({ token, type, contactName, contactTitle, companyName }: { token: string; type: "sla" | "quote"; contactName: string; contactTitle: string; companyName: string }) {
  const [mode, setMode] = useState<"sign" | "decline">("sign");
  const verb = type === "sla" ? "Sign" : "Accept";
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex gap-2" role="tablist">
        <button role="tab" aria-selected={mode === "sign"} onClick={() => setMode("sign")} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "sign" ? "bg-brand-600 text-white" : "bg-slate-100"}`}>{verb} online</button>
        <button role="tab" aria-selected={mode === "decline"} onClick={() => setMode("decline")} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "decline" ? "bg-slate-800 text-white" : "bg-slate-100"}`}>Decline</button>
      </div>
      {mode === "sign" ? (
        <ActionForm action={publicAcceptAction.bind(null, token)} className="space-y-3">
          <p className="text-sm text-slate-600">Typing your name below is your electronic signature. We record the date, time and IP address with it.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="name" label="Full name" defaultValue={contactName} required />
            <Input name="title" label="Job title" defaultValue={contactTitle} />
          </div>
          <Checkbox name="agree" label={`I confirm I'm authorised to ${verb.toLowerCase()} this ${type === "sla" ? "agreement" : "quote"} on behalf of ${companyName}, and I agree to its terms.`} />
          <Submit>{verb} {type === "sla" ? "agreement" : "quote"}</Submit>
        </ActionForm>
      ) : (
        <ActionForm action={publicDeclineAction.bind(null, token)} className="space-y-3">
          <Textarea name="reason" label="What would you like changed?" required rows={3} />
          <Submit variant="secondary">Decline</Submit>
        </ActionForm>
      )}
    </section>
  );
}
