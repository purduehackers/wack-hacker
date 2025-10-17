import { EVERGREEN_WIKI_URL, EVERGREEN_WIKI_USER, EVERGREEN_WIKI_ENDPOINT } from "./consts";
import { env } from "../env";

async function getToken(tokenType:`csrf`|`login`, cookieStr:string = "") {
	const res = await fetch(`${EVERGREEN_WIKI_URL}${EVERGREEN_WIKI_ENDPOINT}?action=query&meta=tokens&type=${tokenType}&format=json`, {
		method: "GET",
		headers: { Cookie: cookieStr },
	});
	const data = await res.json();
	console.log(`got token data: `, data);
	const pathed = (<any>data).query.tokens;
	return ((tokenType == `csrf`) ? pathed.csrftoken : pathed.logintoken);
}

async function login() {
	console.log(`attempting to log in!`);
	//initial request for cookies
	// const init = await fetch(`${EVERGREEN_WIKI_URL}${EVERGREEN_WIKI_ENDPOINT}`);
	// const initialSet:string[] = (<any>init.headers).raw()['set-cookie'] || [];
	// const initCookiesStr = initialSet.map(sc => sc.split(";")[0]).filter(Boolean).join("; ");

	//actual login
	console.log(`getting token...`);
	const token = await getToken(`login`);
	const params = new URLSearchParams({
		action: "login",
		lgname: EVERGREEN_WIKI_USER,
		lgpassword: env.MEDIAWIKI_BOT_KEY,
		lgtoken: token
	});
	const res = await fetch(EVERGREEN_WIKI_URL+EVERGREEN_WIKI_ENDPOINT, {
		method: "POST",
		headers: { 
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: params
	});
	console.log(`got token!`, res);
	return res;
}

export async function appendMediaWikiPage(pageTitle:string, appendText:string, description:string) {
	//log in, get csrf token, get cookies
	const res1 = await login();
	console.log(`logged in!`, res1);

	const cookies = res1.headers.get("set-cookie")?.split(",") ?? [];
	const cookiesStr = cookies.join("; ");
	const token = await getToken(`csrf`, cookiesStr);
	const params = new URLSearchParams({
		action: `edit`,
		format: `json`,
		title: pageTitle,
		appendtext: appendText,
		summary: description,
		token: token
	});

	//actual writing finally
	const res2 = await fetch(EVERGREEN_WIKI_URL+EVERGREEN_WIKI_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Cookie: cookiesStr
		},
		body: params
	});
	const trueRes = await res2.json();

	// check for captcha
	if (trueRes?.edit?.captcha) {
		console.error("Edit requires CAPTCHA:", trueRes.edit.captcha);
	}
	console.log(trueRes);
	console.log(`MW - posted:`);

	return trueRes;
}