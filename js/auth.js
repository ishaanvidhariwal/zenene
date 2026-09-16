async function getCurrentUser() {

    const { data, error } =
        await supabaseClient.auth.getUser();

    if (error || !data.user) {
        return null;
    }

    return data.user;
}
