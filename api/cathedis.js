import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { username, password } = req.query;
    const baseUrl = "https://api.cathedis.delivery";

    if (!username || !password) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    // LOGIN
    const loginRes = await fetch(baseUrl + "/login.jsp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      redirect: "manual"
    });

    const cookie = loginRes.headers.get("set-cookie");
    if (!cookie) return res.status(401).json({ error: "Login failed" });

    const sessionId = /JSESSIONID=([^;]+)/.exec(cookie)?.[1];
    if (!sessionId) return res.status(401).json({ error: "No JSESSIONID" });

    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Cookie": `JSESSIONID=${sessionId}`
    };

    // FIRST BATCH
    const firstPayload = {
      action: "delivery.api.my",
      data: { context: { limit: 500, offset: 0 } }
    };

    const firstRes = await fetch(baseUrl + "/ws/action", {
      method: "POST",
      headers,
      body: JSON.stringify(firstPayload)
    });

    const json1 = await firstRes.json();
    const values1 = json1?.data?.[0]?.values;
    const total = values1?.total || 0;
    const deliveries = values1?.deliveries || [];

    // BUILD OFFSETS (parallel)
    const totalPages = Math.ceil(total / 500);
    const tasks = [];

    for (let i = 1; i < totalPages; i++) {
      const payload = {
        action: "delivery.api.my",
        data: { context: { limit: 500, offset: i * 500 } }
      };

      tasks.push(
        fetch(baseUrl + "/ws/action", {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        }).then(r => r.json())
      );
    }

    // PARALLEL FETCH
    const results = await Promise.all(tasks);

    // MERGE
    for (const r of results) {
      const v = r?.data?.[0]?.values;
      if (v?.deliveries) deliveries.push(...v.deliveries);
    }

    res.status(200).json({
      account: username,
      total,
      rows: deliveries
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
