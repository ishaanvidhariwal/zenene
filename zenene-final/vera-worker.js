/*
==================================================
VERA BACKEND — Cloudflare Worker
==================================================

This is NOT part of the static site. Deploy it
separately as a Cloudflare Worker, then paste its
URL into vera.js as VERA_API.

HOW TO DEPLOY (no CLI needed; or see wrangler.toml
to deploy with `npx wrangler deploy`):

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
6. ALLOWED_ORIGINS below is already set to the live site
   URLs. Add any other domain you serve the site from.
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
    "https://www.zenene.com"
];

const CLAUDE_MODEL = "claude-sonnet-5-5";

// Free fallback (Cloudflare Workers AI, via the AI binding in
// wrangler.toml), used when Claude is unavailable, e.g. no credits.
const FALLBACK_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Cost/abuse guards.
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 20;
const RATE_LIMIT_PER_MINUTE = 12;

const SYSTEM_PROMPT_BASE = `
You are Vera, the companion inside the Zenene app. You are a pause,
not a cure.

Your one rule: the person names it first, never you.
- Never put a label on what someone is feeling before they do. Do not
  say "anxiety", "depression", "panic", "trauma", "burnout", "grief",
  or any other emotion or condition word unless they used it first.
- Answer in the words they already use. If they say "my chest feels
  heavy", you stay with "heavy". You might ask: "Heavy like tired, or
  heavy like scared?" Offer simple, everyday choices so they can find
  their own word, and let them pick, reject, or replace them.
- Once they name something, use their word, exactly, not a clinical
  synonym.

How you talk:
- Short. Usually one to three sentences. Often just one gentle
  question. No lists, no headings, no bold text.
- One question at a time. Never stack questions.
- Slow down. Reflect back what they said before anything else. Silence
  and small steps are fine; you don't need to fix or wrap things up.
- Warm and plain. No therapy jargon, no cheerleading, no "I hear you"
  scripts, no exclamation marks.

Give them what they want:
- Listen the way a good psychologist would: notice what this person needs right now
  and give them that. It might be to be heard, to vent without
  interruption, to untangle something, a practical idea, a distraction,
  or simply company.
- If it's clear, just do it. If it isn't, you may ask once, plainly:
  "Do you want me to just listen, or help you think it through?"
- If they want to be heard, reflect and stay with them; don't fix.
- If they ask for advice or ideas, give real, concrete help, in their
  words, one or two things, not a lecture. Give it in this reply.
  Never answer a direct request with only a question.
- If they want to talk about something light, go with them.
- Whatever they want, the rule still holds: you never name the feeling
  for them.

What you are not:
- Not a therapist or doctor. You never diagnose, prescribe, or claim
  to treat anything. If something sounds heavy and ongoing, you can
  gently ask whether there's someone they trust, or a professional,
  they could bring this to, without pushing.
- Never invent memories, journal entries, or mood history they haven't
  shared.

You may be given "Account context" below, pulled from the user's own
journal and mood check-ins. Use it lightly, only when it helps, and
only in their words (for example, noticing that they wrote "tired"
three days this week). Don't recite it, and don't use it to name a
feeling for them.
`.trim();

const CRISIS_KEYWORDS = [
    "kill myself", "killing myself", "want to die", "wanna die",
    "end my life", "ending my life", "ending it all", "no reason to live",
    "better off dead", "suicide", "suicidal", "self harm", "self-harm",
    "hurt myself", "hurting myself", "cutting myself", "want to disappear",
    "can't go on", "cant go on", "not worth living", "overdose",
    "unalive", "kms", "don't want to be here", "dont want to be here",
    "don't want to live", "dont want to live", "take my own life"
];

const rateBuckets = new Map();

// Best-effort, per-isolate limit. Not global, but it blunts
// scripted abuse of the API key.
function isRateLimited(ip) {
    const now = Date.now();
    const recent = (rateBuckets.get(ip) || []).filter(t => now - t < 60000);
    recent.push(now);
    rateBuckets.set(ip, recent);
    if (rateBuckets.size > 5000) rateBuckets.clear();
    return recent.length > RATE_LIMIT_PER_MINUTE;
}

const CRISIS_INSTRUCTION = `

IMPORTANT — safety: The user's latest message contains language that
suggests they may be in emotional crisis or having thoughts of suicide
or self-harm. Take this seriously and do not minimize it. Respond with
warmth, stay present, and gently ask how they're doing right now / if
they are safe. A block of crisis resources will be appended to your
reply automatically after you respond, so NEVER write any phone
numbers, hotline names, text lines, or websites yourself — just acknowledge that help is
available and encourage them to reach out to a real person right now,
whether that's the resources provided, someone they trust, or
emergency services if they are in immediate danger. In this moment,
safety comes before your naming rule: you may speak plainly about
suicide or self-harm if they have raised it.`;

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

async function askClaude(env, systemPrompt, messages) {
    if (!env.ANTHROPIC_API_KEY) return null;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        },
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: 400,
            system: systemPrompt,
            messages: messages
        })
    });

    if (!res.ok) {
        console.error("Anthropic API error:", await res.text());
        return null;
    }

    const data = await res.json();
    const block = (data.content || []).find(c => c.type === "text");
    return block ? block.text : null;
}

async function askWorkersAI(env, systemPrompt, messages) {
    try {
        const data = await env.AI.run(FALLBACK_MODEL, {
            messages: [{ role: "system", content: systemPrompt }, ...messages],
            max_tokens: 400
        });
        return data && data.response ? data.response : null;
    } catch (err) {
        console.error("Workers AI error:", err);
        return null;
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

        const ip = request.headers.get("CF-Connecting-IP") || "unknown";

        if (isRateLimited(ip)) {
            return json({ error: "Too many messages, slow down a little" }, 429, origin);
        }

        const message = (payload.message || "").toString().trim().slice(0, MAX_MESSAGE_CHARS);
        const history = Array.isArray(payload.history) ? payload.history : [];
        const accessToken = payload.accessToken || null;

        if (!message) {
            return json({ error: "Missing message" }, 400, origin);
        }

        if (!env.ANTHROPIC_API_KEY && !env.AI) {
            return json({ error: "Server is not configured (missing ANTHROPIC_API_KEY)" }, 500, origin);
        }

        const accountContext = await fetchAccountContext(accessToken);

        const crisisDetected = CRISIS_KEYWORDS.some(k => message.toLowerCase().includes(k));

        const systemPrompt =
            SYSTEM_PROMPT_BASE +
            "\n\n" + accountContext +
            (crisisDetected ? CRISIS_INSTRUCTION : "");

        let claudeMessages = history
            .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));

        const last = claudeMessages[claudeMessages.length - 1];

        if (!last || last.role !== "user" || last.content.trim() !== message) {
            claudeMessages.push({ role: "user", content: message });
        }

        claudeMessages = claudeMessages.slice(-MAX_HISTORY_MESSAGES);

        // The API needs the conversation to start with the user.
        while (claudeMessages.length && claudeMessages[0].role !== "user") {
            claudeMessages.shift();
        }

        try {
            let reply = await askClaude(env, systemPrompt, claudeMessages);

            if (!reply && env.AI) {
                reply = await askWorkersAI(env, systemPrompt, claudeMessages);
            }

            if (!reply) {
                return json({ error: "Vera's brain is unavailable right now" }, 502, origin);
            }

            if (crisisDetected) {
                // Only our vetted list may carry numbers; drop any the
                // model wrote itself (they can be outdated or wrong).
                const kept = reply
                    .split(/\n\s*\n/)
                    .filter(p => !/\d{3}|lifeline|hotline|helpline|befrienders|crisis text|samaritans|text ["']?\w+["']? to/i.test(p))
                    .join("\n\n")
                    .trim();
                reply = (kept || "I'm really glad you told me. I'm here with you.") + "\n\n" + CRISIS_RESOURCES_TEXT;
            }

            return json({ message: reply }, 200, origin);

        } catch (err) {
            console.error("Worker error:", err);
            return json({ error: "Unexpected server error" }, 500, origin);
        }
    }
};
