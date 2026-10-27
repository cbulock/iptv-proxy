export interface PlexGuide {id:string;name:string;group:string;install:string;href:string;link:string;tv:boolean;find:string;pin:string}
const apple='https://apps.apple.com/app/id383457673';
const google='https://play.google.com/store/apps/details?id=com.plexapp.android';
const smart='https://support.plex.tv/articles/204080173-which-smart-tv-models-are-supported/';
const downloads='https://www.plex.tv/media-server-downloads/#plex-app';
const tvFind='Open the navigation menu on the left. Look for your personal libraries or More, then choose Bulock Video and one of the libraries shared with you. Some app versions show a Libraries tab instead.';
const desktopFind='In the left sidebar, choose More to see all available libraries. Find Bulock Video and open a library shared with you.';
const pin='If your app offers Pin or Edit beside a library, pin the libraries you use most so they are easier to find next time.';
function tv(id:string,name:string,install:string,href:string,link:string):PlexGuide{return {id,name,group:'TV',install,href,link,tv:true,find:tvFind,pin};}
function desktop(id:string,name:string,install:string):PlexGuide{return {id,name,group:'Computer',install,href:downloads,link:`Get Plex for ${name}`,tv:false,find:desktopFind,pin};}
export const plexGuides:PlexGuide[]=[
 tv('roku','Roku','On your Roku home screen, open the Streaming Store (Streaming Channels on older models). Search for Plex and add the app. Then open Plex.','https://channelstore.roku.com/details/acff0248f28f183c8001cfbffb6bb430%3A919d42aa1a70ad8c8d5943af5fdef2ec/plex-free-movies-and-tv','Get Plex for Roku'),
 tv('fire-tv','Fire TV','Use Find on your Fire TV home screen to search for Plex. Select the Plex app from the Amazon Appstore, choose Download or Get, then open it.','https://www.amazon.com/Plex-Inc-for-Android/dp/B004Y1WCDE','Plex on the Amazon Appstore'),
 tv('apple-tv','Apple TV','Open the App Store on your Apple TV, search for Plex, and select Get. Open Plex after it installs.',apple,'Plex on the App Store'),
 tv('google-tv','Google TV / Android TV','On Google TV, open Apps and search for Plex. On Android TV, open the Google Play Store and search for Plex. Select Install, then Open.',google,'Plex on Google Play'),
 tv('samsung','Samsung TV','Press Home on your remote, open Apps, and search for Plex. Select Install, then open Plex. Check supported models if the app is missing.',smart,'Check supported Samsung TVs'),
 tv('lg','LG TV','Open Apps or LG Content Store from your TV home screen. Search for Plex, select Install, then open it. Check supported models if the app is missing.',smart,'Check supported LG TVs'),
 tv('other-tv','Other smart TV','Check whether Plex supports your TV model, then search for Plex in the TV’s app store. If it is unavailable, use a supported streaming device or select Web browser in this guide.',smart,'Check supported TVs'),
 ...[{id:'ios',name:'iPhone / iPad',href:apple,link:'Get Plex on the App Store',install:'Open the Plex App Store listing on your iPhone or iPad. Tap Get, confirm the installation, then open Plex.'},{id:'android',name:'Android',href:google,link:'Get Plex on Google Play',install:'Open the Plex Google Play listing on your phone or tablet. Tap Install, then open Plex.'}].map(p=>({...p,group:'Phone / tablet',tv:false,find:'Open the Libraries tab and select Bulock Video from the server selector. Open a library shared with you. On older app versions, open the navigation menu and look under More.',pin:'You can return to Libraries whenever you want to watch from Bulock Video.'})),
 desktop('windows','Windows','Open Plex player downloads, choose Windows under Plex for Desktop, and download the installer. Run it, follow the installation prompts, then open Plex.'),
 desktop('mac','Mac','Open Plex player downloads and choose macOS under Plex for Desktop. Download and open the disk image, drag Plex to Applications, then open Plex.'),
 desktop('linux','Linux','Open Plex player downloads and choose Linux under Plex for Desktop. Follow the linked package instructions for your distribution, then launch Plex.'),
 {id:'browser',name:'Web browser',group:'Computer',install:'Open Plex using the button below. No app installation is needed.',href:'',link:'Open Plex',tv:false,find:desktopFind,pin}
];
export function plexGuide(id:unknown){return typeof id==='string'?plexGuides.find(g=>g.id===id):undefined;}
