const { ipcRenderer } = require('electron'); // InterProcess Communications
const puppeteer = require('puppeteer'); // Chrome API
const cheerio = require('cheerio');           // implementation of core jQuery
const { clipboard } = require('electron');

const recipeNameInput = document.getElementById("recipeName");
const searchButton = document.getElementById("searchButton");
const clearButton = document.getElementById("clearButton");
const stopButton = document.getElementById("stopButton");
const mL = document.getElementById('msgs');
const xL = document.getElementById('exact');
const fL = document.getElementById('fuzzy');

let browserPromise;
let lowerCaseTargetRecipeNameWords;
let first = true;
let continueWithResultsPages = true;

// Function definiitions

async function launchPup (opt) {
    // Launch Puppeteer
    // Return a promise of Puppeteer launch 
    //  that resolves to a Puppeteer browser object
    // Called before Mainline

    console.log("launchPup: entered " + Date.now().toString());
    return new Promise(function (resolve) {
        let browserPromise = puppeteer.launch(opt);
        resolve(browserPromise);
    });
}

function addMsg(msgDiv, msg, opt) {
    // Add a message to the #msgs div
    // If opt { indent: true }, add padding-left to message
    // Called throughout

    if (typeof opt === 'undefined') {
        opt = {
            indent: false
        };
    }
    let para = document.createElement("p");
    para.className = "msg";
    if (opt.indent) {
        para.classList.add("pl-2");
    }
    let txnd = document.createTextNode(msg);
    para.appendChild(txnd);
    msgDiv.appendChild(para);
    return;
}

function addProgress(now,max) {
    // Called from searchClick
    // Input:   now - number of articles retrieved
    //          max - number of articles to be retrieved
    // return a progress bar element

    let prog = document.createElement("progress");
    prog.id = "pgProg";
    prog.classList = " progress float-left";
    prog.style.marginTop = "11px"; // aligns progress bar with adjacent text, derived empirically
    prog.max = max;
    prog.value = now;
    return prog;
}

const autoScroll = async (page) => {
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => {
        let totalHeight = 0
        let distance = 300
        let timer = setInterval(() => {
          let scrollHeight = document.body.scrollHeight
          window.scrollBy(0, distance)
          totalHeight += distance
          if(totalHeight >= scrollHeight){
            clearInterval(timer)
            resolve()
          }
        }, 100)
      })
    })
  }

async function displayRecipe(recipe, section) {
    // Add a recipe <article> element to the designated section, exact or fuzzy
    // Input:   <article> element,
    //          target <section> element

    // Extract <article> element HTML
    let oH = await page.evaluate(el => {
        return el.outerHTML
    }, recipe)

    // Load <article> element for Cheerio operations
    let $ = cheerio.load(oH);

    // Remove "stickers" (Easy, Healthy, etc), to avoid adjusting their styles
    let sticker = $('a.sticker')
    if (sticker.length > 0) {
        $('a.sticker').remove()
    }

    // Remove Save button, throws error
    let saveBtn = $('div.control-save-btn')
    if (saveBtn.length > 0) {
        $('div.control-save-btn').remove()
    }

    // If recipe image hasn't been fetched (card-placeholder-image.png),
    //  change src attribute to specify the actual recipe image
    let image =  $('img')
    let imageSrc = $(image).attr('src');
    let imageSrcParts = imageSrc.split('assets/');
    if (imageSrcParts[1] == 'card-placeholder-image.png') {
        let imageSrcData =  $(image).data('src');
        //let imageSrcDataParts = imageSrcData.split('assets/');
        $(image).attr('src', imageSrcData);
    }

    // Create a template element
    let temp = document.createElement('template');

    // Set the template's HTML to the <article> element's HTML
    temp.innerHTML = $.html();

    // Append the <article> element to the designated section,
    //  add 'click' and 'contextmenu' event listebers to the <article> element,
    //  and enable the Clear button
    section.appendChild(temp.content.firstChild);
    section.lastChild.addEventListener("click", articleClick, false);
    section.lastChild.addEventListener("contextmenu", articleOpen, false);
    clearButton.disabled = false;
}

function nMinusOne(candidate) {
    let result = false;
    let candidateWords = candidate.split(/\s+/g);
    let candidateWordsLength = candidateWords.length
    if (candidateWordsLength < 4) {
        return result;
    }
    let n = 0;
    for (i in candidateWords) {
        if (lowerCaseTargetRecipeNameWords.includes(candidateWords[i])) {
            n++;
        }
    }
    if (n >= candidateWordsLength - 1) {
        result = true;
    }
    return result;
}

async function searchClick (evt) {
    // Handler for Search button click event
    console.log("Search clicked");
    evt.preventDefault();

    // Disable the Search button and retrieve the search target recipe name
    searchButton.disabled = true;
    let targetRecipeName = recipeNameInput.value
    let lowerCaseTargetRecipeName = targetRecipeName.toLowerCase();
    lowerCaseTargetRecipeNameWords = lowerCaseTargetRecipeName.split(/\s+/g);
    let targetRecipeNameWordsLength = lowerCaseTargetRecipeNameWords.length

    // Remove any pre-existing messages
    while (mL.firstChild) {
        mL.removeChild(mL.firstChild);
    }

    // First time, wait for completion of puppeteer launch and
    //  create a new browser page
    if (first) {
        let browser = await browserPromise;
        console.log("launchPup: launched " + Date.now().toString());
        page = await browser.newPage();
        page.setDefaultNavigationTimeout(0);
        first = false;
    }

    // Search NYT Cooking for the target recipe name
    let processingPage = 1;
    let noResults = true;
    let noResultsReason = '';
    continueWithResultsPages = true;
    let cookingSearchPage = `https://cooking.nytimes.com/search?q=${encodeURIComponent(targetRecipeName)}`;
    await page.goto(cookingSearchPage, {waitUntil: "networkidle0"});
    //await autoScroll(page);

    do {

        if (processingPage == 1) {
            let pc = await page.$('#pagination-count');
            if (pc !== null) {
                pages = await pc.evaluate(el => {
                    let pagCntText = el.innerText.split(' ');
                    let perPage = pagCntText[2];
                    let totResults = pagCntText[4].replace(',', '');
                    return Math.ceil(totResults / perPage)
                })
            } else {
                pages = 1;
            }
            console.log("Results pages: " + pages.toString());
            // console.log("page count: " + pages)
            // console.log(pages.split(' '))
        }

        if (pages > 1) {
            if (processingPage == 1) {
                let para = document.createElement("p");
                para.classList = "pr-2 pt-2 float-left m-0 text-tiny";
                let txt = "Searching " + pages.toString() + " result pages... "
                let txnd = document.createTextNode(txt);
                para.appendChild(txnd);
                mL.appendChild(para);
                mL.appendChild(addProgress(processingPage,pages));
                stopButton.disabled = false;
            }
        }

        let sr = await page.$('#search-results')
        let srSect = await sr.$('#search-results > section');
        let arrayOfArticleElements = await srSect.$$('article');
        console.log("Number of articles: " + arrayOfArticleElements.length.toString());
        // let arrayOfRecipeNames = await page.evaluate(el => {
        //     let elarrayOfRecipeNames = el.querySelectorAll('article');
        //     let artArray = [];
        //     for (i in elarrayOfRecipeNames) {
        //         artArray.push(elarrayOfRecipeNames[i].innerText)
        //     }
        //     return artArray;
        // }, srSect);
        let arrayOfRecipeNames = [];
        for (i in arrayOfArticleElements) {
            let txt = await page.evaluate(el => {

                return el.querySelector('h3.name').innerText
            }, arrayOfArticleElements[i] );
            arrayOfRecipeNames.push(txt);
        }
        console.log("Number of returned articles: " + arrayOfRecipeNames.length.toString())
        //console.log("Article text:")
        for (a in arrayOfRecipeNames) {
            // console.log(arrayOfRecipeNames[a])

            lowerCaseRecipeName = arrayOfRecipeNames[a].toLowerCase();
            if (lowerCaseRecipeName == lowerCaseTargetRecipeName) {
                console.log("Exact match: " + arrayOfRecipeNames[a]);
                noResults = false;
                await displayRecipe(arrayOfArticleElements[a], xL);
//                let oH = await page.evaluate(el => {
//                    return el.outerHTML
//                }, arrayOfArticleElements[a])
//                let temp = document.createElement('template');
//                let $ = cheerio.load(oH);
//                let sticker = $('a.sticker')
//                if (sticker.length > 0) {
//                    $('a.sticker').remove()
//                }
//                let saveBtn = $('div.control-save-btn')
//                if (saveBtn.length > 0) {
//                    $('div.control-save-btn').remove()
//                }
//                temp.innerHTML = $.html();
//                xL.appendChild(temp.content.firstChild);
//                xL.lastChild.addEventListener("click", articleClick, false);
//                xL.lastChild.addEventListener("contextmenu", articleOpen, false);
//                clearButton.disabled = false;

            } else {
                let fuzzy = false;
                if (targetRecipeNameWordsLength >= 4 ) {
                    fuzzy = nMinusOne(lowerCaseRecipeName);
                }
                if (fuzzy) {
                    console.log("Fuzzy match: " + arrayOfRecipeNames[a]);
                    await displayRecipe(arrayOfArticleElements[a], fL);
                }
            }
        }
        
        if (++processingPage <= pages) {
            let processingPageString = processingPage.toString();
            console.log("Going to search result page " + processingPageString)
            let nxt = '&page=' + processingPageString;
            try {
                gotoResponse = await page.goto(cookingSearchPage + nxt, {waitUntil: "networkidle0"});
            } catch (e) {
                console.error("page.goto error:");
                console.error(e)
                continueWithResultsPages = false;
            }
            
            let responseStatus = gotoResponse.status()
            console.log("Goto response status: " + responseStatus);
            if (responseStatus != 200) {
                continueWithResultsPages = false;
                noResultsReason = " — " + responseStatus + " response on page " + processingPageString
            }

            mL.removeChild(mL.lastChild);
            mL.appendChild(addProgress(processingPage,pages));
        }
    } while (processingPage <= pages && continueWithResultsPages)

    while (mL.firstChild) {
        mL.removeChild(mL.firstChild);
    }
    if (noResults) {
        let noResP = document.createElement("p");
        noResP.classList = "text-error m-0 mt-2";
        let txt = "No results" + noResultsReason;
        let txnd = document.createTextNode(txt);
        noResP.appendChild(txnd);;
        mL.appendChild(noResP);
    }
    

    // Erase Recipe name input field
    recipeNameInput.value = '';
    
}

async function clearClick (evt) {
    // Click event handler for Clear button
    //  Remove article elements
    //  Stop search by setting continueWithResultsPages to false
    console.log("Clear clicked");
    evt.preventDefault();
    while (xL.firstChild) {
        xL.removeChild(xL.lastChild);
    }
    while (fL.firstChild) {
        fL.removeChild(fL.lastChild);
    }
    clearButton.disabled = true;
    continueWithResultsPages = false;
}

async function stopClick (evt) {
    // Click event handler for Stop button
    //  Stop search by setting continueWithResultsPages to false
    console.log("Stop clicked");
    evt.preventDefault();
    stopButton.disabled = true;
    continueWithResultsPages = false;
}

async function articleClick (evt) {
    // Click event handler for recipes (<article> elements)
    //  Form link element for recipe and write to clipboard
    console.log("Article clicked");
    evt.preventDefault();
    let parent = evt.target.parentNode
    while (parent.tagName != "ARTICLE") {
        parent = parent.parentNode
    }
    let name = parent.innerText.split('\n');
    let recipeLink = '<a href="https://cooking.nytimes.com' + parent.dataset.url;
    recipeLink += '">' + name[0] + '</a>';
    console.log(recipeLink);
    clipboard.writeHTML(recipeLink);

}

async function articleOpen (evt) {
    // ContextMenu event handler for recipes (<article> elements)
    //  IPC send to open recipe in Chrome
    console.log("Article opened");
    evt.preventDefault();
    let parent = evt.target.parentNode
    while (parent.tagName != "ARTICLE") {
        parent = parent.parentNode
    }
    let name = parent.innerText.split('\n');
    let recipeURL = "https://cooking.nytimes.com" + parent.dataset.url
    console.log("Opened recipe: " + name[0]);
    console.log(recipeURL);
    ipcRenderer.send('article-open', 'open', recipeURL);
}

// Mainline function
async function Mainline() {

    function chkEnable(e) {
        // If Recipe name field is valid, enable the Search button
    
        console.log("chkEnable entered, type: " + e.type);
        if (e.type == 'paste') {
            // Paste events are fired before the clipboard data is posted to the document,
            //  so the clipboard data must be retrieved and tested.

            let pasteText = e.clipboardData.getData('text');
            searchButton.disabled = (pasteText.length == 0);
    
        } else {
            searchButton.disabled = (recipeNameInput.length == 0);
        }
        // console.log("searchButton.disabled: " + searchButton.disabled);
    }

    // Add EventListener for Search button click. Call function searchClick.
    // Add EventListener for Clear button click. Call function clearClick.
    console.log("Mainline: Adding event listener to Search & Clear buttons");
    searchButton.addEventListener("click", searchClick, false);
    stopButton.addEventListener("click", stopClick, false);
    clearButton.addEventListener("click", clearClick, false);

    // On Recipe name input change, keyup and paste,
    //  enable Search button if recipe name is not empty
    recipeNameInput.addEventListener("change", chkEnable, false);
    recipeNameInput.addEventListener("keyup", chkEnable, false);
    recipeNameInput.addEventListener("paste", chkEnable, false);
    
}

// End of function definitions

// browserPromise = launchPup({devtools: true});
browserPromise = launchPup();

Mainline(); // Launch puppeteer and add event listener for Search button