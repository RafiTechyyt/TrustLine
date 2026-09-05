import { Repository } from "./Repository.js";
import { Announcement } from "../core/Announcement.js";

export class AnnouncementRepository extends Repository {
  static get filename() { return "announcements.json"; }
  static get entity() { return Announcement; }

  ofCollege(collegeId, { liveOnly = true } = {}) {
    return this.where((a) => a.collegeId === collegeId && (!liveOnly || a.isLive))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
  }
}
