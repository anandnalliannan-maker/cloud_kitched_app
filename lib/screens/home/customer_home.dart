import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../models/cart_model.dart';
import '../../services/order_service.dart';
import '../customer/customer_menu.dart';
import '../customer/customer_profile.dart';
import '../role_select_screen.dart';

class CustomerHomeScreen extends StatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  State<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends State<CustomerHomeScreen> {
  final _cart = CartModel();
  final _orderService = OrderService();

  @override
  void dispose() {
    _cart.dispose();
    super.dispose();
  }

  Future<void> _logout() async {
    await FirebaseAuth.instance.signOut();
    if (mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const RoleSelectScreen()),
        (_) => false,
      );
    }
  }

  Future<void> _placeOrder() async {
    if (_cart.items.isEmpty) return;

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    final deliveryType = await showModalBottomSheet<String>(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.delivery_dining),
                title: const Text('Home Delivery'),
                onTap: () => Navigator.of(context).pop('delivery'),
              ),
              ListTile(
                leading: const Icon(Icons.store),
                title: const Text('Self Pickup'),
                onTap: () => Navigator.of(context).pop('pickup'),
              ),
            ],
          ),
        );
      },
    );

    if (deliveryType == null) return;

    final items = _cart.items
        .map((item) => {
              'id': item.id,
              'name': item.name,
              'qty': item.quantity,
              'price': item.price,
            })
        .toList();

    try {
      await _orderService.createOrder(
        customerId: user.uid,
        customerPhone: user.phoneNumber ?? 'Unknown',
        items: items,
        total: _cart.total,
        deliveryType: deliveryType,
      );

      if (!mounted) return;
      _cart.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Order placed')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Some items are out of stock')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Menu'),
        actions: [
          Center(
            child: Padding(
              padding: const EdgeInsets.only(right: 16),
              child: AnimatedBuilder(
                animation: _cart,
                builder: (context, _) => Text('Total: INR ${_cart.total}'),
              ),
            ),
          ),
        ],
      ),
      drawer: Drawer(
        child: Column(
          children: [
            const DrawerHeader(
              decoration: BoxDecoration(color: Colors.teal),
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Text(
                  'Customer',
                  style: TextStyle(color: Colors.white, fontSize: 18),
                ),
              ),
            ),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  ListTile(
                    leading: const Icon(Icons.person),
                    title: const Text('Profile'),
                    onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const CustomerProfileScreen(),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Log out'),
              onTap: _logout,
            ),
          ],
        ),
      ),
      body: CustomerMenuScreen(cart: _cart),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: AnimatedBuilder(
            animation: _cart,
            builder: (context, _) => FilledButton.icon(
              onPressed: _cart.items.isEmpty ? null : _placeOrder,
              icon: const Icon(Icons.shopping_cart_checkout),
              label: Text('Place Order (INR ${_cart.total})'),
            ),
          ),
        ),
      ),
    );
  }
}
