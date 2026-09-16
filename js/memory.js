async function saveMemory(text) {

    const user = await getCurrentUser();

    if (!user) return;

    const { error } = await supabaseClient
        .from("memories")
        .insert({
            user_id: user.id,
            memory: text
        });

    if (error) {
        console.error(error);
    }
}
async function loadMemories() {

    const user = await getCurrentUser();

    const { data, error } = await supabaseClient
        .from("memories")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", {
            ascending: false
        });

    if (error) {
        console.error(error);
        return;
    }

    console.log(data);
}
