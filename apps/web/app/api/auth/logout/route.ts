import { destroySession } from "../../../../lib/auth";
import { apiOk } from "../../../../lib/api";
export async function POST() { await destroySession(); return apiOk({ loggedOut: true }); }
