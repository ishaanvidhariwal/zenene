async function saveMood(mood) {

    const user = await getCurrentUser();

    if (!user) return;

    const { error } = await supabaseClient
        .from("mood_entries")
        .insert({
            user_id: user.id,
            mood: mood
        });

    if (error) {
        console.error(error);
    }
}

<button onclick="saveMood('happy')">😊</button>
<button onclick="saveMood('okay')">😐</button>
<button onclick="saveMood('sad')">😔</button>
<button onclick="saveMood('stressed')">😣</button>
