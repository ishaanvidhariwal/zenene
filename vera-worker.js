/*
==================================================
VERA BACKEND — Cloudflare Worker
==================================================

This is NOT part of the static site. Deploy it
separately as a Cloudflare Worker, then paste its
URL into vera.js as VERA_API.

HOW TO DEPLOY (no CLI needed):

1. Go to https://dash.cloudflare.com -> Workers & Pages
   -> Create -> "Create Worker".
2. Give it a name (e.g. "vera-api"), click "Deploy" to
   create the shell, then click "Edit code".
3. Delete the default code and paste this entire file in.
4. Click "Save and deploy".
5. Go to the worker's Settings -> Variables and Secrets:
     - Add a SECRET named  ANTHROPIC_API_KEY
       (get one at https://console.anthropic.com/settings/keys)
   (SUPABASE_URL / SUPABASE_ANON_KEY are already public
   values baked in below, matching js/supabase.js.)
6. Edit ALLOWED_ORIGINS below to match the real URL(s)
   your site is served from, then re-save/deploy.
7. Copy the worker's URL (shown at the top of the editor,
   looks like https://vera-api.<your-subdomain>.workers.dev)
   into VERA_API in vera.js.

==================================================
*/

const SUPABASE_URL = "https://iunezjccqjxlydzzrfzh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hVaM64loLJeTKLN0LeYJKQ_x0oD6Xy4";

// EDIT THIS: the origin(s) your site is actually served from.
const ALLOWED_ORIGINS = [
    "https://ishaanvidhariwal.github.io",
    "https://zenene.com",
    "https://www.zenene.com",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
];

const CLAUDE_MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT_BASE = `
You are Vera, the AI companion inside the Zenene app.

Who you are:
- A warm, psychologically-informed listener. Think attentive friend
  who also understands emotional wellbeing, not a clinician.
- You validate feelings before offering perspective. You ask gentle,
  specific follow-up questions rather than lecturing.
- You are NOT a licensed therapist and never diagnose, prescribe, or
  claim to treat any condition. For anything beyond everyday support
  (ongoing depression, trauma, relationship or medical crises), you
  encourage — without being pushy — talking to a licensed professional.
- Keep most replies short (a few sentences to a short paragraph).
  Only go longer if the user is clearly asking for detail or a plan.
- Never fabricate memories, journal entries, or mood history the user
  hasn't actually shared with you.

You may be given "Account context" below, pulled from the user's own
journal and mood check-ins. Use it naturally to show you remember and
care — for example noticing a pattern or gently checking in on
something they mentioned — but don't recite it like a report, and
don't bring it up if it isn't relevant to what they're saying now.
`.trim();

const CRISIS_KEYWORDS = [
    "kill myself", "killing myself", "want to die", "wanna die",
    "end my life", "ending my life", "ending it all", "no reason to live",
    "better off dead", "suicide", "suicidal", "self harm", "self-harm",
    "hurt myself", "hurting myself", "cutting myself", "want to disappear",
    "can't go on", "cant go on", "not worth living", "overdose"
];

const CRISIS_INSTRUCTION = `

IMPORTANT — safety: The user's latest message contains language that
suggests they may be in emotional crisis or having thoughts of suicide
or self-harm. Take this seriously and do not minimize it. Respond with
warmth, stay present, and gently ask how they're doing right now / if
they are safe. A block of crisis resources will be appended to your
reply automatically after you respond, so you do not need to list
phone numbers or hotlines yourself — just acknowledge that help is
available and encourage them to reach out to a real person right now,
whether that's the resources provided, someone they trust, or
emergency services if they are in immediate danger.`;

const CRISIS_RESOURCES_TEXT = `—
If you're in crisis or thinking about suicide, please reach out right now:
• US: call or text 988 (Suicide & Crisis Lifeline)
• US/Canada: text HOME to 741741 (Crisis Text Line)
• UK/ROI: call Samaritans at 116 123
• Elsewhere: findahelpline.com has a directory by country
If you're in immediate danger, please contact local emergency services.`;

function corsHeaders(origin) {
    const allowed = ALLOWED_ORIGINS.includes(origin);
    return {
        "Access-Control-Allow-Origin": allowed ? origin : "null",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
    };
}

function json(body, status, origin) {
    return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin)
        }
    });
}

async function fetchAccountContext(accessToken) {
    if (!accessToken) {
        return "The user is not logged in, so no account history is available.";
    }

    try {
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${accessToken}`
            }
        });

        if (!userRes.ok) {
            return "The user's session could not be verified, so no account history is available.";
        }

        const user = await userRes.json();
        const userId = user.id;

        const authHeaders = {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`
        };

        const [profileRes, moodRes, journalRes] = await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=display_name`, { headers: authHeaders }),
            fetch(`${SUPABASE_URL}/rest/v1/mood_entries?user_id=eq.${userId}&select=entry_date,mood&order=entry_date.desc&limit=14`, { headers: authHeaders }),
            fetch(`${SUPABASE_URL}/rest/v1/journal_entries?user_id=eq.${userId}&select=text,mood,date,timestamp&order=timestamp.desc&limit=3`, { headers: authHeaders })
        ]);

        const profile = profileRes.ok ? await profileRes.json() : [];
        const moods = moodRes.ok ? await moodRes.json() : [];
        const journalEntries = journalRes.ok ? await journalRes.json() : [];

        const name = profile[0] && profile[0].display_name ? profile[0].display_name : null;

        const moodLines = moods.length
            ? moods.map(m => `  - ${m.entry_date}: ${m.mood}`).join("\n")
            : "  (no mood check-ins recorded yet)";

        const journalLines = journalEntries.length
            ? journalEntries.map((e, i) => {
                const excerpt = (e.text || "").slice(0, 200).trim();
                return `  ${i + 1}. (${e.date || "unknown date"}, mood: ${e.mood || "n/a"}) "${excerpt}${e.text && e.text.length > 200 ? "..." : ""}"`;
            }).join("\n")
            : "  (no journal entries recorded yet)";

        return [
            "Account context for this user (use naturally, do not recite verbatim):",
            `- Name: ${name || "not set"}`,
            "- Recent mood check-ins (most recent first):",
            moodLines,
            "- Recent journal entries (most recent first, may be truncated):",
            journalLines
        ].join("\n");

    } catch (err) {
        return "There was an error loading account history, so proceed without it.";
    }
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get("Origin") || "";

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders(origin) });
        }

        if (request.method !== "POST") {
            return json({ error: "Method not allowed" }, 405, origin);
        }

        if (!ALLOWED_ORIGINS.includes(origin)) {
            return json({ error: "Origin not allowed" }, 403, origin);
        }

        let payload;

        try {
            payload = await request.json();
        } catch (err) {
            return json({ error: "Invalid JSON body" }, 400, origin);
        }

        const message = (payload.message || "").toString().trim();
        const history = Array.isArray(payload.history) ? payload.history : [];
        const accessToken = payload.accessToken || null;

        if (!message) {
            return json({ error: "Missing message" }, 400, origin);
        }

        if (!env.ANTHROPIC_API_KEY) {
            return json({ error: "Server is not configured (missing ANTHROPIC_API_KEY)" }, 500, origin);
        }

        const accountContext = await fetchAccountContext(accessToken);

        const crisisDetected = CRISIS_KEYWORDS.some(k => message.toLowerCase().includes(k));

        const systemPrompt =
            SYSTEM_PROMPT_BASE +
            "\n\n" + accountContext +
            (crisisDetected ? CRISIS_INSTRUCTION : "");

        const claudeMessages = history
            .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .map(m => ({ role: m.role, content: m.content }));

        if (!claudeMessages.length || claudeMessages[claudeMessages.length - 1].content !== message) {
            claudeMessages.push({ role: "user", content: message });
        }

        try {
            const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "x-api-key": env.ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    model: CLAUDE_MODEL,
                    max_tokens: 700,
                    system: systemPrompt,
                    messages: claudeMessages
                })
            });

            if (!claudeRes.ok) {
                const errText = await claudeRes.text();
                console.error("Anthropic API error:", errText);
                return json({ error: "Vera's brain is unavailable right now" }, 502, origin);
            }

            const data = await claudeRes.json();
            const block = (data.content || []).find(c => c.type === "text");
            let reply = block ? block.text : "I'm having trouble finding the words right now.";

            if (crisisDetected) {
                reply = reply.trim() + "\n\n" + CRISIS_RESOURCES_TEXT;
            }

            return json({ message: reply }, 200, origin);

        } catch (err) {
            console.error("Worker error:", err);
            return json({ error: "Unexpected server error" }, 500, origin);
        }
    }
};
