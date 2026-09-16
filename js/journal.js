<textarea
    id="journalText"
    placeholder="What's on your mind?"
></textarea>

<button id="saveJournal">
    Save entry
</button>

<div id="entries"></div>

document.getElementById("saveJournal")
.addEventListener("click", async () => {

    const user = await getCurrentUser();

    if (!user) return;

    const content =
        document.getElementById("journalText").value;

    const { error } = await supabaseClient
        .from("journal_entries")
        .insert({
            user_id: user.id,
            content: content
        });

    if (error) {
        console.error(error);
        return;
    }

    document.getElementById("journalText").value = "";

    loadJournal();
});

async function loadJournal() {

    const user = await getCurrentUser();

    const { data, error } = await supabaseClient
        .from("journal_entries")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", {
            ascending: false
        });

    if (error) {
        console.error(error);
        return;
    }

    const container =
        document.getElementById("entries");

    container.innerHTML = "";

    data.forEach(entry => {

        const div = document.createElement("div");

        div.innerHTML = `
            <p>${entry.content}</p>
            <small>
                ${new Date(entry.created_at).toLocaleDateString()}
            </small>
        `;

        container.appendChild(div);
    });
}
