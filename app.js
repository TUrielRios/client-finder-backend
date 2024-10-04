const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const extractItems = async (page) => {
    let maps_data = await page.evaluate(() => {
        return Array.from(document.querySelectorAll(".Nv2PK")).map((el) => {
            const link = el.querySelector("a.hfpxzc")?.getAttribute("href");

            // Filtramos los spans que contienen números de teléfono válidos
            const phone = Array.from(el.querySelectorAll(".W4Efsd span"))
                .map(span => span.textContent.trim())
                .find(text => text.match(/^\+?\d{1,4}[\d\s.-]{7,}$/));  // Números de teléfono comunes con longitud mínima


            return {
                title: el.querySelector(".qBF1Pd")?.textContent.trim(),
                address: el.querySelector(".W4Efsd:last-child > .W4Efsd:nth-of-type(1) > span:last-child")?.textContent.replaceAll("·", "").trim(),
                description: el.querySelector(".W4Efsd:last-child > .W4Efsd:nth-of-type(2)")?.textContent.replace("·", "").trim(),
                website: el.querySelector("a.lcr4fd")?.getAttribute("href"),
                category: el.querySelector(".W4Efsd:last-child > .W4Efsd:nth-of-type(1) > span:first-child")?.textContent.replaceAll("·", "").trim(),
                phone_num: phone || 'No phone available',  // Solo mostramos si el teléfono es válido
            };
        });
    });
    return maps_data;
};



const scrollPage = async (page, scrollContainer, itemTargetCount) => {
    let items = [];
    let previousHeight = await page.evaluate(`document.querySelector("${scrollContainer}").scrollHeight`);
    while (itemTargetCount > items.length) {
        items = await extractItems(page);
        await page.evaluate(`document.querySelector("${scrollContainer}").scrollTo(0, document.querySelector("${scrollContainer}").scrollHeight)`);
        await page.evaluate(`document.querySelector("${scrollContainer}").scrollHeight > ${previousHeight}`);
        // Reemplazo de `waitForTimeout` por una espera personalizada
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return items;
};

// Modifica la lógica para llamar a la nueva función después de obtener el resto de los datos
const getMapsData = async (query) => {
    const browser = await puppeteer.launch({ headless: false, args: ["--disabled-setuid-sandbox", "--no-sandbox"] });
    const [page] = await browser.pages();

    await page.setExtraHTTPHeaders({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4882.194 Safari/537.36",
    });

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 5000)); 

    let businesses = await scrollPage(page, ".m6QErb[aria-label]", 20);

    // Itera sobre cada empresa y busca su correo en el sitio web
    // businesses = await Promise.all(businesses.map(async (business) => {
    //     return await getBusinessDataWithEmail(page, business);
    // }));

    await browser.close();
    return businesses;
};

app.get('/', async (req,res) =>{
    return res.send('Hello world!')
})


// Ruta para hacer scraping de negocios en Google Maps
app.post('/api/scrape', async (req, res) => {
    const { query } = req.body;
    if (!query) {
        return res.status(400).json({ error: 'Falta la consulta de búsqueda' });
    }

    try {
        const data = await getMapsData(query);
        res.json({ businesses: data });
    } catch (error) {
        console.error('Error al hacer scraping:', error);
        res.status(500).json({ error: 'Error al hacer scraping' });
    }
});

// Configuración del puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});