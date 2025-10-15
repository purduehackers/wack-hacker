import { EVERGREEN_WIKI_URL, EVERGREEN_WIKI_ENDPOINT } from "./consts";

async function getCsrfToken() {
	const res = await fetch(`${EVERGREEN_WIKI_URL}${EVERGREEN_WIKI_ENDPOINT}?action=query&meta=tokens&type=csrf&format=json`, {
		method: "GET",
		headers: { "Content-Type": "application/json" },
	});
	const data = await res.json();
	return data.query.tokens.csrftoken;
}

export async function appendMediaWikiPage(pageTitle:string, appendText:string, appendMessage:string) {
	let token = await getCsrfToken();
	const params = new URLSearchParams({
		action: "edit",
		title: pageTitle,
		appendtext: appendText,
		summary: appendMessage,
		token,
		format: "json"
	});

	const res = await fetch(EVERGREEN_WIKI_URL+EVERGREEN_WIKI_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: params
	});

	return await res.json();
}