import { Repository } from "./Repository.js";
import { Message } from "../core/Message.js";

export class MessageRepository extends Repository {
  static get filename() { return "messages.json"; }
  static get entity() { return Message; }

  ofComplaint(complaintId, { includeInternal = false } = {}) {
    return this.where((m) => m.complaintId === complaintId && (includeInternal || !m.internal))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  unreadForDesk(complaintId) {
    return this.where((m) => m.complaintId === complaintId && m.fromReporter && !m.readByDesk).length;
  }

  unreadForReporter(complaintId) {
    return this.where((m) => m.complaintId === complaintId && !m.internal && !m.fromReporter && !m.readByReporter).length;
  }

  lastFrom(complaintId, authorType) {
    return this.ofComplaint(complaintId, { includeInternal: true })
      .filter((m) => m.authorType === authorType)
      .at(-1) ?? null;
  }
}
