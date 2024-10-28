const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const { parsePhoneNumberFromString } = require('libphonenumber-js'); // Librería para validar teléfonos

const app = express();
app.use(cors());
app.use(express.json());

const extractItems = async (page) => {
    try {
        return await page.evaluate(() => {
            return Array.from(document.querySelectorAll(".Nv2PK")).map((el) => {
                const link = el.querySelector("a.hfpxzc")?.getAttribute("href");

                // Filtramos los spans que contienen números de teléfono válidos
                let phone = Array.from(el.querySelectorAll(".W4Efsd span"))
                    .map(span => span.textContent.trim())
                    .find(text => text.match(/^\+?\d{1,4}[\d\s.-]{7,}$/));  // Números de teléfono comunes con longitud mínima

                // Retornar los datos de cada negocio
                return {
                    title: el.querySelector(".qBF1Pd")?.textContent.trim(),
                    address: el.querySelector(".W4Efsd:last-child > .W4Efsd:nth-of-type(1) > span:last-child")?.textContent.replaceAll("·", "").trim(),
                    description: el.querySelector(".W4Efsd:last-child > .W4Efsd:nth-of-type(2)")?.textContent.replace("·", "").trim(),
                    website: el.querySelector("a.lcr4fd")?.getAttribute("href"),
                    category: el.querySelector(".W4Efsd:last-child > .W4Efsd:nth-of-type(1) > span:first-child")?.textContent.replaceAll("·", "").trim(),
                    phone_num: phone || 'No phone available',
                    link
                };
            });
        });
    } catch (error) {
        throw new Error("Error al extraer los datos de los negocios. Posible cambio en la estructura de la página.");
    }
};

const scrollPage = async (page, scrollContainer, itemTargetCount) => {
    try {
        let items = [];
        let previousHeight = await page.evaluate(`document.querySelector("${scrollContainer}").scrollHeight`);
        let scrollAttempts = 0;
        const maxScrollAttempts = 10;

        while (itemTargetCount > items.length && scrollAttempts < maxScrollAttempts) {
            items = await extractItems(page);

            // Desplazar hacia abajo
            await page.evaluate(`document.querySelector("${scrollContainer}").scrollTo(0, document.querySelector("${scrollContainer}").scrollHeight)`);

            // Esperar un poco para que la página cargue más resultados
            await new Promise(resolve => setTimeout(resolve, 2000));

            const newHeight = await page.evaluate(`document.querySelector("${scrollContainer}").scrollHeight`);
            
            // Si la altura no cambia después del scroll, detener
            if (newHeight === previousHeight) {
                console.log('No se cargan más elementos, deteniendo el scroll.');
                break;
            }
            previousHeight = newHeight;
            scrollAttempts++;
        }
        return items;
    } catch (error) {
        throw new Error("Error durante el scroll en la página.");
    }
};

const validatePhone = (phone) => {
    const phoneNumber = parsePhoneNumberFromString(phone, 'AR'); // Reemplaza 'AR' por tu código de país
    if (phoneNumber && phoneNumber.isValid()) {
        return phoneNumber.formatInternational();
    }
    return 'No phone available';
};

const getMapsData = async (query) => {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const [page] = await browser.pages();
        await page.setExtraHTTPHeaders({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4882.194 Safari/537.36",
        });

        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Espera adicional para asegurar la carga de los elementos
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Iniciar scroll y recolección de datos
        let businesses = await scrollPage(page, ".m6QErb[aria-label]", 100);

        // Validar y formatear los números de teléfono
        businesses = businesses.map(business => ({
            ...business,
            phone_num: validatePhone(business.phone_num),
        }));

        return businesses;
    } catch (error) {
        throw new Error(`Error durante la navegación de Google Maps: ${error.message}`);
    } finally {
        if (browser) await browser.close();
    }
};

app.get('/', async (req, res) => {
    return res.send('Hello world!');
});

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
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
 