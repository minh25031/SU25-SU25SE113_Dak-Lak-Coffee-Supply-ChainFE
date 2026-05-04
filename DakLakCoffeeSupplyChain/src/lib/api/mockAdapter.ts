// Lightweight client-side mock adapter that reads JSON files from `public/mocks/`
// and returns objects shaped like axios responses: `{ data: ... }`.
// This is intentionally simple — it's for local development when the backend
// is not available. It does not persist changes.

async function fetchJson(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Mock file not found: ${path}`);
  return res.json();
}

function normalizeUrl(url: string) {
  const path = url.split("?")[0];
  return path.replace(/^\/+/, "");
}

function resourceFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts; // e.g. ["ProcurementPlans"] or ["Region","wards"] or ["ProcurementPlans","plan-1"]
}

function pickById(json: any, id: string) {
  if (!Array.isArray(json)) return json;

  return (
    json.find((it: any) => {
      if (!it || typeof it !== "object") return false;
      const values = Object.values(it).map(String);
      if (values.includes(id)) return true;
      if (it.id === id || it.detailId === id || it.cropSeasonId === id || it.planId === id || it.userId === id || it.progressId === id) {
        return true;
      }
      return false;
    }) || null
  );
}

const mockAdapter = {
  async get(url: string) {
    const normalized = normalizeUrl(url);
    const parts = resourceFromPath(normalized);
    if (parts.length === 0) return { data: null };

    const resource = parts[0];
    const maybeSub = parts[1];
    const maybeId = parts[2];

    // Special case: /notifications/user?page=X&pageSize=Y
    if (resource === "notifications" && maybeSub === "user") {
      const json = await fetchJson(`/mocks/Notifications.json`);
      const pageSize = 10;
      return {
        data: {
          data: Array.isArray(json) ? json : [],
          totalCount: (Array.isArray(json) ? json.length : 0),
          page: 1,
          pageSize: pageSize,
          totalPages: Math.ceil((Array.isArray(json) ? json.length : 0) / pageSize),
        }
      };
    }

    // Special case: /notifications/unread-count
    if (resource === "notifications" && maybeSub === "unread-count") {
      const json = await fetchJson(`/mocks/Notifications.json`);
      const unreadCount = (Array.isArray(json) ? json.filter((n: any) => !n.isRead).length : 0);
      return { data: { data: unreadCount } };
    }

    // Special case: /CultivationRegistration/GetByUser
    if (resource === "CultivationRegistration" && maybeSub === "GetByUser") {
      const json = await fetchJson(`/mocks/CultivationRegistration.json`);
      return { data: Array.isArray(json) ? json : [] };
    }

    const filePath = `/mocks/${resource}.json`;
    const json = await fetchJson(filePath);

    // Special-case list endpoints that include a filtered item in the path.
    if (resource === "ProcurementPlans" && maybeSub === "Available") {
      if (maybeId && Array.isArray(json)) {
        return { data: json.find((item: any) => item.planId === maybeId || item.planCode === maybeId) || null };
      }
      return { data: json };
    }

    if (resource === "CultivationRegistration" && maybeSub === "Available") {
      if (maybeId && Array.isArray(json)) {
        return { data: json.filter((item: any) => item.planId === maybeId) };
      }
      return { data: json };
    }

    if (resource === "CropProgresses" && maybeSub === "by-detail") {
      if (maybeId && Array.isArray(json)) {
        return { data: { progresses: json.filter((item: any) => item.cropSeasonDetailId === maybeId) } };
      }
      return { data: { progresses: [] } };
    }

    // Special case: /Roles/BusinessAndFarmer - return filtered roles
    if (resource === "Roles" && maybeSub === "BusinessAndFarmer") {
      if (Array.isArray(json)) {
        return { data: json.filter((r: any) => r.roleName === "Business" || r.roleName === "Farmer") };
      }
      return { data: json };
    }

    // Special case: /Payments/plan-posting-fee/{planId}
    if (resource === "Payments" && maybeSub === "plan-posting-fee") {
      return { data: { amount: 2500000, feeType: "PlanPostingFee", description: "Phí đăng công khai dự toán" } };
    }

    // Special case: /ProcurementPlans/{planId}/payment-status
    if (resource === "ProcurementPlans" && maybeId === "payment-status") {
      return { data: { paymentStatus: "Completed", message: "Thanh toán thành công", paymentTime: new Date().toISOString() } };
    }

    // Special case: /WarehouseOutboundRequests/all
    if (resource === "WarehouseOutboundRequests" && maybeSub === "all") {
      return { data: { status: 1, message: "Success", data: json } };
    }

    // If request is like /Resource/Available or /Resource/wards, return full json
    if (!maybeSub) {
      return { data: json };
    }

    if (maybeSub === "Available" || maybeSub === "wards" || maybeSub === "all") {
      return { data: json };
    }

    // If second segment looks like an id, try to find matching object
    if (typeof maybeSub === "string") {
      if (Array.isArray(json)) {
        return { data: pickById(json, maybeSub) };
      }
      // fallback: return full json
      return { data: json };
    }

    return { data: json };
  },
  async post(url: string, body?: any) {
    const normalized = normalizeUrl(url);
    const parts = resourceFromPath(normalized);

    // Handle login specially: return a fake JWT string that jwt-decode can parse
    if (parts[0] === "Auth" && parts[1] && parts[1].toLowerCase().includes("login")) {
      const header = { alg: "HS256", typ: "JWT" };

      // Try to find a user in mocks by email to return the proper role/name/avatar
      let user = null;
      try {
        const users = await fetchJson(`/mocks/UserAccounts.json`);
        user = (users || []).find((u: any) => u.email === (body && body.email));
      } catch (e) {
        // ignore
      }

      const payload: any = {
        nameid: user?.userId || "user-1",
        name: user?.name || "Mock User",
        email: (body && body.email) || user?.email || "mock@gmail.com",
        role: user?.roleName || "Admin",
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
        avatar: user?.profilePictureUrl || "/images/avatar.png",
        iat: Math.floor(Date.now() / 1000),
      };

      function base64UrlEncode(obj: any) {
        const str = typeof obj === "string" ? obj : JSON.stringify(obj);
        const b64 = typeof window !== "undefined" && (window as any).btoa
          ? (window as any).btoa(unescape(encodeURIComponent(str)))
          : Buffer.from(str).toString("base64");
        return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      }

      const token = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.signature`;
      return { data: token };
    }

    // Special case: /Payments/vnpay/create-url
    if (parts[0] === "Payments" && parts[1] === "vnpay" && parts[2] === "create-url") {
      return { data: { url: "https://sandbox.vnpayment.vn/paygate/pay.html?mock=true" } };
    }

    // Special case: /Payments/wallet-payment
    if (parts[0] === "Payments" && parts[1] === "wallet-payment") {
      return { data: { success: true, message: "Thanh toán ví thành công", transactionId: "WAL-" + Date.now() } };
    }

    // Special case: /WarehouseOutboundRequests
    if (parts[0] === "WarehouseOutboundRequests") {
      return { data: { status: 1, message: "Gửi yêu cầu thành công", data: body } };
    }

    // Default: echo created resource
    return { data: body };
  },
  async patch(url: string, body?: any) {
    return { data: body };
  },
  async delete(url: string) {
    return { data: null };
  },
};

export default mockAdapter;
