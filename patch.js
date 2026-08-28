    if (action === 'adminGetOrders') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized. Please log in again.'
        });
      }
      return createJsonResponse({
        success: true,
        orders: getAllOrdersForAdmin()
      });
    }
