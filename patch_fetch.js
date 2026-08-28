          const url = new URL(ORDER_API_URL);
          url.searchParams.set("action", "adminGetOrders");
          url.searchParams.set("token", currentAdminToken);
          
          const response = await fetch(url.toString(), { method: "GET", mode: "cors" });
          if (!response.ok) throw new Error("Network request failed (" + response.status + ")");
          const data = await response.json();
