const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

const app = express();
app.use(cors());
app.use(express.json());

// Función para detectar el tipo de web que tiene el negocio
const analyzeWebsite = (website) => {
    if (!website || website === 'No website') {
        return { type: 'none', needsWebsite: true, priority: 'high' };
    }
    
    const url = website.toLowerCase();
    
    if (url.includes('instagram.com') || url.includes('facebook.com') || 
        url.includes('tiktok.com') || url.includes('twitter.com')) {
        return { type: 'social_only', needsWebsite: true, priority: 'high' };
    }
    
    if (url.includes('wordpress.com') || url.includes('wix.com') || 
        url.includes('squarespace.com') || url.includes('weebly.com')) {
        return { type: 'basic_platform', needsWebsite: false, priority: 'medium' };
    }
    
    return { type: 'professional', needsWebsite: false, priority: 'low' };
};

// Función para calcular score de oportunidad
const calculateOpportunityScore = (business) => {
    let score = 0;
    
    // Verificar que websiteAnalysis existe antes de usarlo
    if (!business.websiteAnalysis) {
        console.warn('websiteAnalysis missing for business:', business.title);
        return 0;
    }
    
    // Sin web o solo redes sociales = alta prioridad
    if (business.websiteAnalysis.needsWebsite) score += 40;
    
    // Tiene teléfono válido
    if (business.phone_num && business.phone_num !== 'No phone available') score += 20;
    
    // Categorías con mayor probabilidad de necesitar web
    const highValueCategories = [
        'restaurant', 'hotel', 'dentist', 'lawyer', 'doctor', 'clinic',
        'beauty', 'salon', 'gym', 'fitness', 'real estate', 'construction',
        'accounting', 'consulting', 'photography', 'catering', 'retail'
    ];
    
    if (business.category && highValueCategories.some(cat => 
        business.category.toLowerCase().includes(cat))) {
        score += 25;
    }
    
    // Bonus por tener descripción detallada
    if (business.description && business.description.length > 50) score += 10;
    
    // Penalización si ya tiene web profesional
    if (business.websiteAnalysis.type === 'professional') score -= 30;
    
    return Math.max(0, Math.min(100, score));
};

const extractItems = async (page) => {
    try {
        return await page.evaluate(() => {
            return Array.from(document.querySelectorAll(".Nv2PK")).map((el) => {
                const link = el.querySelector("a.hfpxzc")?.getAttribute("href");

                // Extraer rating y número de reseñas
                const ratingElement = el.querySelector(".MW4etd");
                const rating = ratingElement ? parseFloat(ratingElement.textContent.trim()) : null;
                
                const reviewsElement = el.querySelector(".UY7F9");
                const reviewsText = reviewsElement ? reviewsElement.textContent.trim() : '';
                const reviewCount = reviewsText.match(/$$(\d+)$$/) ? parseInt(reviewsText.match(/$$(\d+)$$/)[1]) : 0;

                // Extraer horarios de funcionamiento
                const hoursElement = el.querySelector(".G8aQO");
                const hours = hoursElement ? hoursElement.textContent.trim() : 'Hours not available';

                // Filtramos los spans que contienen números de teléfono válidos
                let phone = Array.from(el.querySelectorAll(".W4Efsd span"))
                    .map(span => span.textContent.trim())
                    .find(text => text.match(/^\+?\d{1,4}[\d\s.-]{7,}$/));

                // Retornar los datos de cada negocio con información adicional
                return {
                    title: el.querySelector(".qBF1Pd")?.textContent.trim() || 'Unknown Business',
                    address: el.querySelector(".W4Efsd:last-child > .W4Efsd:nth-of-type(1) > span:last-child")?.textContent.replaceAll("·", "").trim() || 'Address not available',
                    description: el.querySelector(".W4Efsd:last-child > .W4Efsd:nth-of-type(2)")?.textContent.replace("·", "").trim() || '',
                    website: el.querySelector("a.lcr4fd")?.getAttribute("href") || null,
                    category: el.querySelector(".W4Efsd:last-child > .W4Efsd:nth-of-type(1) > span:first-child")?.textContent.replaceAll("·", "").trim() || 'Unknown Category',
                    phone_num: phone || 'No phone available',
                    rating: rating,
                    reviewCount: reviewCount,
                    hours: hours,
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
        let scrollAttempts = 20;
        const maxScrollAttempts = 40;

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
    try {
        const phoneNumber = parsePhoneNumberFromString(phone, 'AR');
        if (phoneNumber && phoneNumber.isValid()) {
            return phoneNumber.formatInternational();
        }
    } catch (error) {
        console.warn('Error validating phone:', phone, error.message);
    }
    return 'No phone available';
};

const getMapsData = async (query, limit = 100) => {
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
        let businesses = await scrollPage(page, ".m6QErb[aria-label]", limit);

        // Filtrar negocios válidos (que tengan al menos título)
        businesses = businesses.filter(business => business.title && business.title !== 'Unknown Business');

        // Procesar y enriquecer los datos - ORDEN CORREGIDO
        businesses = businesses.map(business => {
            // 1. Primero validar teléfono
            const validatedPhone = validatePhone(business.phone_num);
            
            // 2. Luego analizar website
            const websiteAnalysis = analyzeWebsite(business.website);
            
            // 3. Crear objeto business completo con websiteAnalysis
            const enrichedBusiness = {
                ...business,
                phone_num: validatedPhone,
                websiteAnalysis,
                extractedAt: new Date().toISOString()
            };
            
            // 4. Finalmente calcular opportunity score con el objeto completo
            const opportunityScore = calculateOpportunityScore(enrichedBusiness);
            
            return {
                ...enrichedBusiness,
                opportunityScore
            };
        });

        // Ordenar por score de oportunidad (mayor a menor)
        businesses.sort((a, b) => b.opportunityScore - a.opportunityScore);

        console.log(`Procesados ${businesses.length} negocios para la consulta: ${query}`);
        return businesses;
    } catch (error) {
        throw new Error(`Error durante la navegación de Google Maps: ${error.message}`);
    } finally {
        if (browser) await browser.close();
    }
};

app.get('/', async (req, res) => {
    return res.send('Lead Generator API - Sistema de búsqueda de clientes potenciales');
});

app.post('/api/scrape', async (req, res) => {
    const { query, limit = 100, filters } = req.body;
    
    if (!query) {
        return res.status(400).json({ error: 'Falta la consulta de búsqueda' });
    }

    try {
        let data = await getMapsData(query, limit);
        
        // Verificar que todos los negocios tengan websiteAnalysis
        data = data.filter(business => {
            if (!business.websiteAnalysis) {
                console.warn('Business without websiteAnalysis filtered out:', business.title);
                return false;
            }
            return true;
        });
        
        // Aplicar filtros si se especifican
        if (filters) {
            if (filters.needsWebsite) {
                data = data.filter(business => 
                    business.websiteAnalysis && business.websiteAnalysis.needsWebsite);
            }
            
            if (filters.minRating) {
                data = data.filter(business => 
                    business.rating && business.rating >= filters.minRating);
            }
            
            if (filters.minReviews) {
                data = data.filter(business => 
                    business.reviewCount >= filters.minReviews);
            }
            
            if (filters.categories && filters.categories.length > 0) {
                data = data.filter(business =>
                    business.category && filters.categories.some(cat => 
                        business.category.toLowerCase().includes(cat.toLowerCase()))
                );
            }
        }

        // Estadísticas de la búsqueda
        const stats = {
            total: data.length,
            needsWebsite: data.filter(b => b.websiteAnalysis && b.websiteAnalysis.needsWebsite).length,
            hasPhone: data.filter(b => b.phone_num !== 'No phone available').length,
            highOpportunity: data.filter(b => b.opportunityScore >= 70).length,
            averageRating: data.length > 0 ? data.reduce((sum, b) => sum + (b.rating || 0), 0) / data.length : 0
        };

        res.json({ 
            businesses: data,
            stats,
            query,
            extractedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error al hacer scraping:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para obtener estadísticas de oportunidades
app.post('/api/analyze', async (req, res) => {
    const { businesses } = req.body;
    
    if (!businesses || !Array.isArray(businesses)) {
        return res.status(400).json({ error: 'Se requiere un array de negocios' });
    }

    try {
        const validBusinesses = businesses.filter(b => b.websiteAnalysis);
        
        const analysis = {
            totalBusinesses: validBusinesses.length,
            highPriority: validBusinesses.filter(b => b.websiteAnalysis.priority === 'high').length,
            mediumPriority: validBusinesses.filter(b => b.websiteAnalysis.priority === 'medium').length,
            lowPriority: validBusinesses.filter(b => b.websiteAnalysis.priority === 'low').length,
            averageOpportunityScore: validBusinesses.length > 0 ? 
                validBusinesses.reduce((sum, b) => sum + (b.opportunityScore || 0), 0) / validBusinesses.length : 0,
            topCategories: getTopCategories(validBusinesses),
            websiteTypes: {
                none: validBusinesses.filter(b => b.websiteAnalysis.type === 'none').length,
                socialOnly: validBusinesses.filter(b => b.websiteAnalysis.type === 'social_only').length,
                basicPlatform: validBusinesses.filter(b => b.websiteAnalysis.type === 'basic_platform').length,
                professional: validBusinesses.filter(b => b.websiteAnalysis.type === 'professional').length
            }
        };

        res.json(analysis);
    } catch (error) {
        console.error('Error in analysis:', error);
        res.status(500).json({ error: error.message });
    }
});

// Función auxiliar para obtener las categorías más comunes
const getTopCategories = (businesses) => {
    const categoryCount = {};
    businesses.forEach(business => {
        if (business.category) {
            categoryCount[business.category] = (categoryCount[business.category] || 0) + 1;
        }
    });
    
    return Object.entries(categoryCount)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([category, count]) => ({ category, count }));
};

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Lead Generator escuchando en el puerto ${PORT}`);
});