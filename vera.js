const veraForm =
    document.getElementById("veraForm");

const veraInput =
    document.getElementById("veraInput");

const veraMessages =
    document.getElementById("veraMessages");

const veraWelcome =
    document.getElementById("veraWelcome");

const veraSend =
    document.getElementById("veraSend");



/*
==================================================
VERA BACKEND
==================================================

Deploy vera-worker.js as a Cloudflare Worker (see
the instructions at the top of that file), then put
its URL here.

Example:

const VERA_API =
    "https://vera-api.yourname.workers.dev";

==================================================
*/

const VERA_API =
    "https://vera-api.zenene.workers.dev";



const VERA_CONFIGURED =
    VERA_API.startsWith("https://");



/*
==================================================
CRISIS FALLBACK

The worker appends crisis resources to its reply.
This copy only shows when the worker can't be
reached, so nobody in crisis gets a dead end.
==================================================
*/

const CRISIS_PATTERN =
    /kill myself|killing myself|want to die|wanna die|end my life|ending my life|ending it all|no reason to live|better off dead|suicid|self[- ]?harm|hurt(ing)? myself|cutting myself|can'?t go on|not worth living|overdose|unalive|\bkms\b|don'?t want to (be here|live)|take my own life/i;

const CRISIS_FALLBACK =
    "I can't reach my full self right now, but what you said matters, and I don't want you to sit with it alone.\n\n" +
    "• US: call or text 988 (Suicide & Crisis Lifeline)\n" +
    "• US/Canada: text HOME to 741741 (Crisis Text Line)\n" +
    "• UK/ROI: call Samaritans at 116 123\n" +
    "• Elsewhere: findahelpline.com\n" +
    "If you're in immediate danger, please contact local emergency services.";



let conversation = [];

let isThinking = false;

let accessToken = null;

let currentUserId = null;

let currentConvoId = null;

let convos = [];



/*
==================================================
ACCOUNT AWARENESS

Vera personalizes her responses using the user's
journal/mood history when they're logged in. This
only reads their name for the greeting client-side —
the actual journal/mood context is fetched securely
by the worker using their access token.
==================================================
*/

async function initVeraAccount() {

    if (
        typeof supabaseClient ===
        "undefined"
    ) {

        return;

    }


    const { data } =
        await supabaseClient.auth.getSession();

    if (
        data &&
        data.session
    ) {

        accessToken =
            data.session.access_token;

        currentUserId =
            data.session.user.id;

    }


    const profile =
        typeof getCurrentProfile ===
        "function"
            ? await getCurrentProfile()
            : null;

    const loginNote =
        document.getElementById(
            "veraLoginNote"
        );


    if (profile) {

        if (loginNote) {

            loginNote.style.display =
                "none";

        }


        const subtitle =
            document.querySelector(
                ".vera-subtitle"
            );

        if (
            subtitle &&
            profile.display_name
        ) {

            subtitle.textContent =
                "a space to understand yourself, " +
                profile.display_name;

        }

    } else if (loginNote) {

        loginNote.style.display =
            "block";

    }

}


initVeraAccount()
    .catch(function(error) {

        console.error(
            "Vera account error:",
            error
        );

    })
    .then(initSidebar);



/*
==================================================
CONVERSATIONS

Logged in: saved to Supabase (vera_conversations),
so they follow the person across devices.
Logged out: saved in this browser only.
==================================================
*/

const LOCAL_CONVOS_KEY =
    "vera_conversations";


function readLocalConvos() {

    try {

        return JSON.parse(
            localStorage.getItem(LOCAL_CONVOS_KEY)
        ) || [];

    } catch (error) {

        return [];

    }

}


function writeLocalConvos(list) {

    try {

        localStorage.setItem(
            LOCAL_CONVOS_KEY,
            JSON.stringify(list.slice(0, 50))
        );

    } catch (error) {

        console.error(
            "Couldn't save conversation locally:",
            error
        );

    }

}


function convoTitle(messages) {

    const first =
        messages.find(function(m) {
            return m.role === "user";
        });

    const text =
        first
            ? first.content.trim()
            : "new conversation";

    return text.length > 42
        ? text.slice(0, 40) + "…"
        : text;

}


async function loadConvos() {

    if (!currentUserId) {

        convos =
            readLocalConvos();

        return;

    }


    const { data, error } =
        await supabaseClient
            .from("vera_conversations")
            .select("id, title, updated_at")
            .order("updated_at", { ascending: false })
            .limit(50);


    if (error) {

        console.error(
            "Couldn't load conversations:",
            error
        );

        convos = [];

        return;

    }


    convos =
        data;

}


async function loadConvoMessages(id) {

    if (!currentUserId) {

        const found =
            readLocalConvos().find(function(c) {
                return c.id === id;
            });

        return found
            ? found.messages
            : [];

    }


    const { data, error } =
        await supabaseClient
            .from("vera_conversations")
            .select("messages")
            .eq("id", id)
            .single();


    if (error) {

        console.error(
            "Couldn't open conversation:",
            error
        );

        return null;

    }


    return data.messages || [];

}


async function saveCurrentConvo() {

    const title =
        convoTitle(conversation);

    const now =
        new Date().toISOString();


    if (!currentUserId) {

        const list =
            readLocalConvos().filter(function(c) {
                return c.id !== currentConvoId;
            });

        if (!currentConvoId) {

            currentConvoId =
                "local-" + Date.now();

        }

        list.unshift({
            id: currentConvoId,
            title: title,
            updated_at: now,
            messages: conversation
        });

        writeLocalConvos(list);

        convos =
            list;

        renderConvoList();

        return;

    }


    if (!currentConvoId) {

        const { data, error } =
            await supabaseClient
                .from("vera_conversations")
                .insert({
                    user_id: currentUserId,
                    title: title,
                    messages: conversation
                })
                .select("id")
                .single();


        if (error) {

            console.error(
                "Couldn't save conversation:",
                error
            );

            return;

        }


        currentConvoId =
            data.id;

    } else {

        const { error } =
            await supabaseClient
                .from("vera_conversations")
                .update({
                    title: title,
                    messages: conversation,
                    updated_at: now
                })
                .eq("id", currentConvoId);


        if (error) {

            console.error(
                "Couldn't save conversation:",
                error
            );

        }

    }


    await loadConvos();

    renderConvoList();

}


async function deleteConvo(id) {

    if (!confirm("Delete this conversation?")) {

        return;

    }


    if (currentUserId) {

        const { error } =
            await supabaseClient
                .from("vera_conversations")
                .delete()
                .eq("id", id);


        if (error) {

            console.error(
                "Couldn't delete conversation:",
                error
            );

            return;

        }

    } else {

        writeLocalConvos(
            readLocalConvos().filter(function(c) {
                return c.id !== id;
            })
        );

    }


    if (id === currentConvoId) {

        startNewConvo();

    }


    await loadConvos();

    renderConvoList();

}


function formatConvoDate(iso) {

    const date =
        new Date(iso);

    const today =
        new Date();

    if (date.toDateString() === today.toDateString()) {

        return "today";

    }

    return date.toLocaleDateString(
        undefined,
        { month: "short", day: "numeric" }
    );

}


function renderConvoList() {

    const list =
        document.getElementById("veraConvoList");

    list.innerHTML =
        "";


    if (!convos.length) {

        const empty =
            document.createElement("li");

        empty.className =
            "vera-side-empty";

        empty.textContent =
            "Your conversations will show up here.";

        list.appendChild(empty);

        return;

    }


    convos.forEach(function(convo) {

        const item =
            document.createElement("li");

        if (convo.id === currentConvoId) {

            item.className =
                "active";

        }


        const open =
            document.createElement("button");

        open.type =
            "button";

        open.className =
            "vera-convo-open";


        const title =
            document.createElement("span");

        title.className =
            "vera-convo-title";

        title.textContent =
            convo.title;


        const date =
            document.createElement("span");

        date.className =
            "vera-convo-date";

        date.textContent =
            formatConvoDate(convo.updated_at);


        open.appendChild(title);

        open.appendChild(date);

        open.addEventListener(
            "click",
            function() {
                openConvo(convo.id);
            }
        );


        const remove =
            document.createElement("button");

        remove.type =
            "button";

        remove.className =
            "vera-delete";

        remove.setAttribute(
            "aria-label",
            "Delete conversation"
        );

        remove.textContent =
            "×";

        remove.addEventListener(
            "click",
            function() {
                deleteConvo(convo.id);
            }
        );


        item.appendChild(open);

        item.appendChild(remove);

        list.appendChild(item);

    });

}


async function openConvo(id) {

    if (isThinking) {

        return;

    }


    const messages =
        await loadConvoMessages(id);

    if (!messages) {

        return;

    }


    currentConvoId =
        id;

    conversation =
        messages;


    veraMessages.innerHTML =
        "";

    if (veraWelcome) {

        veraWelcome.style.display =
            messages.length
                ? "none"
                : "";

    }


    messages.forEach(function(m) {

        addMessage(
            m.role,
            m.content
        );

    });


    renderConvoList();

    closeSidebar();

}


function startNewConvo() {

    if (isThinking) {

        return;

    }


    currentConvoId =
        null;

    conversation =
        [];

    veraMessages.innerHTML =
        "";

    if (veraWelcome) {

        veraWelcome.style.display =
            "";

    }


    renderConvoList();

    closeSidebar();

    veraInput.focus();

}



/*
==================================================
MEMORY

Small things Vera keeps between conversations, in
the person's own words (memories table). They can
see and delete every one of them here.
==================================================
*/

async function loadMemoryList() {

    if (!currentUserId) {

        return;

    }


    const { data, error } =
        await supabaseClient
            .from("memories")
            .select("id, memory")
            .order("created_at", { ascending: false })
            .limit(50);


    if (error) {

        console.error(
            "Couldn't load memories:",
            error
        );

        return;

    }


    const list =
        document.getElementById("veraMemoryList");

    list.innerHTML =
        "";


    if (!data.length) {

        const empty =
            document.createElement("li");

        empty.className =
            "vera-side-empty";

        empty.textContent =
            "Nothing yet. When you share something worth keeping, Vera holds onto it here, in your words.";

        list.appendChild(empty);

        return;

    }


    data.forEach(function(row) {

        const item =
            document.createElement("li");

        const text =
            document.createElement("span");

        text.textContent =
            row.memory;


        const remove =
            document.createElement("button");

        remove.type =
            "button";

        remove.className =
            "vera-delete";

        remove.setAttribute(
            "aria-label",
            "Forget this"
        );

        remove.textContent =
            "×";

        remove.addEventListener(
            "click",
            async function() {

                const { error } =
                    await supabaseClient
                        .from("memories")
                        .delete()
                        .eq("id", row.id);

                if (error) {

                    console.error(
                        "Couldn't forget memory:",
                        error
                    );

                    return;

                }

                loadMemoryList();

            }
        );


        item.appendChild(text);

        item.appendChild(remove);

        list.appendChild(item);

    });

}


function addRememberedNote(items) {

    const note =
        document.createElement("div");

    note.className =
        "vera-remembered";

    note.textContent =
        "vera will remember: " +
        items.join("; ");

    veraMessages.appendChild(note);

    scrollChat();

}



/*
==================================================
SIDEBAR
==================================================
*/

const veraSidebar =
    document.getElementById("veraSidebar");


function closeSidebar() {

    veraSidebar.classList.remove("open");

}


async function initSidebar() {

    if (currentUserId) {

        document.getElementById("veraSideNote").style.display =
            "none";

        document.getElementById("veraMemorySection").style.display =
            "block";

        loadMemoryList();

    }


    await loadConvos();

    renderConvoList();

}


document
    .getElementById("veraNewChat")
    .addEventListener(
        "click",
        startNewConvo
    );


document
    .getElementById("veraSidebarToggle")
    .addEventListener(
        "click",
        function() {
            veraSidebar.classList.toggle("open");
        }
    );



/*
==================================================
ADD MESSAGE
==================================================
*/

function addMessage(role, content) {

    const row =
        document.createElement("div");

    row.className =
        "vera-message-row " +
        (
            role === "user"
                ? "vera-user-row"
                : "vera-assistant-row"
        );


    if (role === "assistant") {

        const avatar =
            document.createElement("div");

        avatar.className =
            "vera-avatar";

        avatar.textContent =
            "V";

        row.appendChild(
            avatar
        );

    }


    const bubble =
        document.createElement("div");

    bubble.className =
        "vera-message " +
        (
            role === "user"
                ? "vera-user-message"
                : "vera-assistant-message"
        );


    bubble.textContent =
        content;


    row.appendChild(
        bubble
    );


    veraMessages.appendChild(
        row
    );


    scrollChat();

}



/*
==================================================
SCROLL
==================================================
*/

function scrollChat() {

    const chat =
        document.getElementById(
            "veraChat"
        );

    chat.scrollTop =
        chat.scrollHeight;

}



/*
==================================================
THINKING INDICATOR
==================================================
*/

function showThinking() {

    const row =
        document.createElement("div");

    row.className =
        "vera-message-row vera-assistant-row";

    row.id =
        "veraThinking";


    const avatar =
        document.createElement("div");

    avatar.className =
        "vera-avatar";

    avatar.textContent =
        "V";


    const bubble =
        document.createElement("div");

    bubble.className =
        "vera-message " +
        "vera-assistant-message " +
        "vera-thinking";


    for (
        let i = 0;
        i < 3;
        i++
    ) {

        const dot =
            document.createElement("span");

        bubble.appendChild(
            dot
        );

    }


    row.appendChild(
        avatar
    );

    row.appendChild(
        bubble
    );


    veraMessages.appendChild(
        row
    );


    scrollChat();

}



/*
==================================================
HIDE THINKING
==================================================
*/

function hideThinking() {

    const thinking =
        document.getElementById(
            "veraThinking"
        );


    if (thinking) {

        thinking.remove();

    }

}



/*
==================================================
SEND MESSAGE
==================================================
*/

async function sendMessage(message) {

    if (
        !message ||
        isThinking
    ) {

        return;

    }


    isThinking =
        true;


    veraSend.disabled =
        true;

    veraInput.disabled =
        true;


    if (veraWelcome) {

        veraWelcome.style.display =
            "none";

    }


    addMessage(
        "user",
        message
    );


    conversation.push({

        role: "user",

        content: message

    });


    showThinking();


    try {

        if (!VERA_CONFIGURED) {

            throw new Error(
                "VERA_API is not set"
            );

        }


        const response =
            await fetch(
                VERA_API,
                {

                    method:
                        "POST",

                    headers: {

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify({

                            message:
                                message,

                            history:
                                conversation,

                            accessToken:
                                accessToken,

                            conversationId:
                                currentConvoId

                        })

                }
            );


        if (!response.ok) {

            throw new Error(
                "Vera server error " +
                response.status
            );

        }


        const data =
            await response.json();


        hideThinking();


        const reply =
            data.message ||
            "I'm having trouble responding right now.";


        addMessage(
            "assistant",
            reply
        );


        conversation.push({

            role:
                "assistant",

            content:
                reply

        });


        if (
            Array.isArray(data.remembered) &&
            data.remembered.length
        ) {

            addRememberedNote(
                data.remembered
            );

            loadMemoryList();

        }


        saveCurrentConvo()
            .catch(function(error) {

                console.error(
                    "Couldn't save conversation:",
                    error
                );

            });


    }


    catch (error) {

        console.error(
            "Vera error:",
            error
        );


        hideThinking();


        // Drop the unanswered message so the next try
        // doesn't send two user turns in a row.
        conversation.pop();


        const fallback =
            CRISIS_PATTERN.test(message)
                ? CRISIS_FALLBACK
                : String(error.message).includes("429")
                    ? "Let's take a breath. Try again in a minute."
                    : "I can't connect right now. Please try again in a moment.";


        addMessage(
            "assistant",
            fallback
        );

    }


    veraInput.disabled =
        false;

    veraSend.disabled =
        false;

    isThinking =
        false;


    veraInput.focus();

}



/*
==================================================
FORM SUBMISSION
==================================================
*/

veraForm.addEventListener(
    "submit",
    function(event) {

        event.preventDefault();


        const message =
            veraInput.value.trim();


        if (!message) {

            return;

        }


        veraInput.value =
            "";


        veraInput.style.height =
            "auto";


        sendMessage(
            message
        );

    }
);



/*
==================================================
ENTER TO SEND
==================================================
*/

veraInput.addEventListener(
    "keydown",
    function(event) {

        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {

            event.preventDefault();

            veraForm.requestSubmit();

        }

    }
);



/*
==================================================
AUTO GROW TEXTAREA
==================================================
*/

veraInput.addEventListener(
    "input",
    function() {

        this.style.height =
            "auto";


        this.style.height =
            Math.min(
                this.scrollHeight,
                150
            ) + "px";

    }
);



/*
==================================================
SUGGESTION BUTTONS
==================================================
*/

document
    .querySelectorAll(
        ".vera-suggestions button"
    )
    .forEach(
        function(button) {

            button.addEventListener(
                "click",
                function() {

                    veraInput.value =
                        this.dataset.message;

                    veraInput.focus();

                }
            );

        }
    );
