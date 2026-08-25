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

WE WILL PUT YOUR CLOUDFLARE WORKER URL HERE
AFTER WE CREATE IT.

Example:

const VERA_API =
    "https://vera-api.yourname.workers.dev";

==================================================
*/

const VERA_API =
    "YOUR_CLOUDFLARE_WORKER_URL";



let conversation = [];

let isThinking = false;



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
                                conversation

                        })

                }
            );


        if (!response.ok) {

            throw new Error(
                "Vera server error"
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


        addMessage(
            "assistant",
            "I can't connect to Vera right now. Please try again in a moment."
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
