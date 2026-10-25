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


initVeraAccount();



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
                                accessToken

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
