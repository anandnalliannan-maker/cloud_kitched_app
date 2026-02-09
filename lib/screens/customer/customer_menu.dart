import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../models/cart_model.dart';
import '../../services/menu_service.dart';
import '../../services/order_service.dart';

class CustomerMenuScreen extends StatefulWidget {
  const CustomerMenuScreen({super.key});

  @override
  State<CustomerMenuScreen> createState() => _CustomerMenuScreenState();
}

class _CustomerMenuScreenState extends State<CustomerMenuScreen> {
  final _menuService = MenuService();
  final _orderService = OrderService();
  final _cart = CartModel();

  @override
  void dispose() {
    _cart.dispose();
    super.dispose();
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
              'name': item.name,
              'qty': item.quantity,
              'price': item.price,
            })
        .toList();

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
              child: ValueListenableBuilder(
                valueListenable: _cart,
                builder: (context, _, __) => Text('Total: INR ${_cart.total}'),
              ),
            ),
          ),
        ],
      ),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: _menuService.watchMenu(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          final docs = snapshot.data?.docs ?? [];
          final visible = docs.where((doc) => doc.data()['enabled'] == true).toList();

          if (visible.isEmpty) {
            return const Center(child: Text('No items available'));
          }

          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: visible.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final doc = visible[index];
              final data = doc.data();
              final name = data['name'] ?? '';
              final price = data['price'] ?? 0;
              final description = data['description'] ?? '';
              final quantity = data['quantity'] ?? 0;

              return Card(
                child: ListTile(
                  title: Text(name),
                  subtitle: Text('INR $price | Qty: $quantity\n$description'),
                  trailing: IconButton(
                    icon: const Icon(Icons.add_circle_outline),
                    onPressed: () => _cart.addItem(
                      id: doc.id,
                      name: name,
                      price: price,
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: FilledButton.icon(
            onPressed: _cart.items.isEmpty ? null : _placeOrder,
            icon: const Icon(Icons.shopping_cart_checkout),
            label: ValueListenableBuilder(
              valueListenable: _cart,
              builder: (context, _, __) => Text('Place Order (INR ${_cart.total})'),
            ),
          ),
        ),
      ),
    );
  }
}
