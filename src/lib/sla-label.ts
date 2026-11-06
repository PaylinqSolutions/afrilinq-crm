import { formatMinutes, type SlaClock } from "./rules/sla";

export function slaLabel(c: SlaClock | null | undefined) {
  if (!c) return "No SLA";
  const which = c.metric === "first_response" ? "Response" : "Resolution";
  switch (c.state) {
    case "met": return `${which} met`;
    case "breached": return `${which} breached${c.completedAt ? "" : ` ${formatMinutes(-c.remainingMins)} ago`}`;
    case "paused": return `${which} paused`;
    case "escalate": return `${which} at risk · ${formatMinutes(c.remainingMins)} left`;
    case "warning": return `${which} due in ${formatMinutes(c.remainingMins)}`;
    default: return `${which} in ${formatMinutes(c.remainingMins)}`;
  }
}
